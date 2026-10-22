import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	createTrialStore,
	expireTrials,
	type TrialStore,
} from "@/lib/plans/trial";

const NOW = new Date("2026-10-22T06:15:00.000Z");

function fakeStore(
	expired: { id: string; slug: string }[],
	failOn: string[] = [],
): TrialStore & { suspended: string[] } {
	const suspended: string[] = [];
	return {
		suspended,
		listExpired: vi.fn(async () => expired),
		suspend: vi.fn(async (id: string) => {
			if (failOn.includes(id)) throw new Error("boom");
			suspended.push(id);
		}),
	};
}

afterEach(() => vi.restoreAllMocks());

describe("expireTrials", () => {
	it("suspende cada empresa vencida", async () => {
		const store = fakeStore([
			{ id: "t1", slug: "a" },
			{ id: "t2", slug: "b" },
		]);
		const r = await expireTrials({ store, now: () => NOW });
		expect(r).toEqual({ checked: 2, suspended: 2 });
		expect(store.suspended).toEqual(["t1", "t2"]);
		expect(store.suspend).toHaveBeenCalledWith("t1", "trial_vencido");
		expect(store.listExpired).toHaveBeenCalledWith(NOW, 100);
	});

	it("si una falla, la otra igual se suspende", async () => {
		vi.spyOn(console, "error").mockImplementation(() => {});
		const store = fakeStore(
			[
				{ id: "t1", slug: "a" },
				{ id: "t2", slug: "b" },
			],
			["t1"],
		);
		const r = await expireTrials({ store, now: () => NOW });
		expect(r).toEqual({ checked: 2, suspended: 1 });
		expect(store.suspended).toEqual(["t2"]);
		expect(console.error).toHaveBeenCalled();
	});

	it("sin vencidas devuelve ceros", async () => {
		const r = await expireTrials({ store: fakeStore([]), now: () => NOW });
		expect(r).toEqual({ checked: 0, suspended: 0 });
	});

	it("si listExpired tira, loguea y devuelve ceros", async () => {
		const spy = vi.spyOn(console, "error").mockImplementation(() => {});
		const store: TrialStore = {
			listExpired: async () => {
				throw new Error("db caída");
			},
			suspend: vi.fn(),
		};
		const r = await expireTrials({ store, now: () => NOW });
		expect(r).toEqual({ checked: 0, suspended: 0 });
		expect(spy).toHaveBeenCalled();
		expect(store.suspend).not.toHaveBeenCalled();
	});
});

type Call = { op: string; args: unknown[] };
function fakeAdmin(opts: {
	list?: { data: unknown; error: { message: string } | null };
	updated?: { id: string }[];
	updateError?: { message: string } | null;
	eventsError?: { message: string } | null;
}) {
	const log: { table: string; calls: Call[] }[] = [];
	const admin = {
		from(table: string) {
			const entry = { table, calls: [] as Call[] };
			log.push(entry);
			const result = () => {
				const first = entry.calls[0]?.op;
				if (table === "events") return { error: opts.eventsError ?? null };
				if (first === "update")
					return {
						data: opts.updated ?? [],
						error: opts.updateError ?? null,
					};
				return opts.list ?? { data: [], error: null };
			};
			const builder: Record<string, unknown> = {
				// biome-ignore lint/suspicious/noThenProperty: simula el query builder
				then: (res: (v: unknown) => unknown) => res(result()),
			};
			for (const op of [
				"select",
				"eq",
				"is",
				"lt",
				"order",
				"limit",
				"update",
				"insert",
			]) {
				builder[op] = (...args: unknown[]) => {
					entry.calls.push({ op, args });
					return builder;
				};
			}
			return builder;
		},
	};
	return { admin: admin as unknown as SupabaseClient, log };
}

describe("createTrialStore.listExpired", () => {
	it("filtra plan free, sin suspender, activas y vencidas", async () => {
		const { admin, log } = fakeAdmin({
			list: { data: [{ id: "t1", slug: "a" }], error: null },
		});
		const r = await createTrialStore(admin).listExpired(NOW, 50);
		expect(r).toEqual([{ id: "t1", slug: "a" }]);
		const c = log[0].calls;
		expect(log[0].table).toBe("tenants");
		expect(c).toContainEqual({ op: "eq", args: ["plan", "free"] });
		expect(c).toContainEqual({ op: "is", args: ["suspended_reason", null] });
		expect(c).toContainEqual({ op: "eq", args: ["active", true] });
		expect(c).toContainEqual({
			op: "lt",
			args: ["trial_ends_at", NOW.toISOString()],
		});
		expect(c).toContainEqual({ op: "order", args: ["trial_ends_at"] });
		expect(c).toContainEqual({ op: "limit", args: [50] });
	});

	it("tira si la consulta falla", async () => {
		const { admin } = fakeAdmin({
			list: { data: null, error: { message: "x" } },
		});
		await expect(createTrialStore(admin).listExpired(NOW, 5)).rejects.toThrow();
	});
});

describe("createTrialStore.suspend", () => {
	it("solo actualiza si sigue sin suspender y en plan free, y deja el evento", async () => {
		const { admin, log } = fakeAdmin({ updated: [{ id: "t1" }] });
		await createTrialStore(admin).suspend("t1", "trial_vencido");
		const upd = log[0].calls;
		expect(log[0].table).toBe("tenants");
		expect(upd[0]).toEqual({
			op: "update",
			args: [{ suspended_reason: "trial_vencido" }],
		});
		expect(upd).toContainEqual({ op: "eq", args: ["id", "t1"] });
		expect(upd).toContainEqual({ op: "is", args: ["suspended_reason", null] });
		expect(upd).toContainEqual({ op: "eq", args: ["plan", "free"] });
		expect(log[1].table).toBe("events");
		expect(log[1].calls[0]).toEqual({
			op: "insert",
			args: [
				{
					tenant_id: "t1",
					type: "tenant.suspended",
					summary: "Plan gratis vencido",
					payload: { reason: "trial_vencido" },
				},
			],
		});
	});

	it("si el update no cambió ninguna fila, no inserta evento", async () => {
		const { admin, log } = fakeAdmin({ updated: [] });
		await createTrialStore(admin).suspend("t1", "trial_vencido");
		expect(log.map((l) => l.table)).toEqual(["tenants"]);
	});

	it("tira si el update falla", async () => {
		const { admin } = fakeAdmin({ updateError: { message: "x" } });
		await expect(
			createTrialStore(admin).suspend("t1", "trial_vencido"),
		).rejects.toThrow();
	});

	it("un fallo al insertar el evento no se propaga", async () => {
		const spy = vi.spyOn(console, "error").mockImplementation(() => {});
		const { admin } = fakeAdmin({
			updated: [{ id: "t1" }],
			eventsError: { message: "x" },
		});
		await expect(
			createTrialStore(admin).suspend("t1", "trial_vencido"),
		).resolves.toBeUndefined();
		expect(spy).toHaveBeenCalled();
	});
});
