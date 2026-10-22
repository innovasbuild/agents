// runFolderResearch y createResearchStore, con store, propose y admin falsos.
import { describe, expect, it, vi } from "vitest";
import { GENERIC_FOLDERS } from "@/lib/onboarding/folder-template";
import { runFolderResearch } from "@/lib/onboarding/research-run";
import {
	createResearchStore,
	type ResearchStore,
} from "@/lib/onboarding/research-store";
import type { FolderProposal } from "@/lib/onboarding/services/propose-folders";

const folder = (slug: string, restricted = false) => ({
	slug,
	name: slug,
	description: `Lo que va en ${slug}`,
	restricted,
});

function proposal(found: boolean): FolderProposal {
	return {
		found,
		company: {
			summary: "Hace cosas",
			industry: "Rubro",
			sizeHint: null,
			location: null,
			products: [],
		},
		brand: { colors: [], fonts: [], logoUrl: null },
		folders: [folder("direccion", true), folder("finanzas", true), folder("a")],
	};
}

function fakeStore(): ResearchStore & {
	start: ReturnType<typeof vi.fn>;
	finish: ReturnType<typeof vi.fn>;
	fail: ReturnType<typeof vi.fn>;
} {
	return {
		start: vi.fn(async () => {}),
		finish: vi.fn(async () => {}),
		fail: vi.fn(async () => {}),
		read: vi.fn(async () => null),
	};
}

const input = {
	tenantId: "t1",
	domain: "acme.com",
	displayName: "Acme",
	hint: null as string | null,
	model: "m",
};
const readPage = async () => ({
	ok: false as const,
	reason: "x",
	message: "x",
});

function run(
	store: ResearchStore,
	output: FolderProposal | undefined | Error,
	hint: string | null = null,
) {
	const propose = vi.fn(async () => {
		if (output instanceof Error) throw output;
		return {
			output,
			pagesRead: 1,
			usage: undefined,
			providerMetadata: undefined,
		};
	});
	return runFolderResearch(
		{ ...input, hint },
		// biome-ignore lint/suspicious/noExplicitAny: fake de proposeFolders
		{ store, propose: propose as any, readPage },
	);
}

describe("runFolderResearch", () => {
	it("found true: start y finish con la propuesta normalizada", async () => {
		const store = fakeStore();
		await run(store, proposal(true));
		expect(store.start).toHaveBeenCalledWith("t1", null);
		const [, result] = store.finish.mock.calls[0];
		expect(result.found).toBe(true);
		expect(result.folders.length).toBeGreaterThanOrEqual(8);
		expect(store.fail).not.toHaveBeenCalled();
	});

	it("found false sin hint: finish con found false", async () => {
		const store = fakeStore();
		await run(store, proposal(false));
		const [, result] = store.finish.mock.calls[0];
		expect(result.found).toBe(false);
		expect(result.folders.length).toBeGreaterThanOrEqual(8);
	});

	it("con hint: finish con found true y carpetas normalizadas", async () => {
		const store = fakeStore();
		await run(store, proposal(false), "somos una ferretería");
		expect(store.start).toHaveBeenCalledWith("t1", "somos una ferretería");
		const [, result] = store.finish.mock.calls[0];
		expect(result.found).toBe(true);
		expect(result.folders.length).toBeGreaterThanOrEqual(8);
		expect(result.folders.map((f: { slug: string }) => f.slug)).toContain("a");
		expect(GENERIC_FOLDERS.length).toBeGreaterThanOrEqual(8);
	});

	it("propose tira: guarda el código, el mensaje crudo va al log", async () => {
		const store = fakeStore();
		const spy = vi.spyOn(console, "error").mockImplementation(() => {});
		await expect(
			run(store, new Error("secret internal detail")),
		).resolves.toBeUndefined();
		expect(store.fail).toHaveBeenCalledWith("t1", "fallo_modelo");
		expect(JSON.stringify(store.fail.mock.calls)).not.toContain("secret");
		expect(
			spy.mock.calls.some((c) =>
				c.some((a) => String(a).includes("secret internal detail")),
			),
		).toBe(true);
		expect(store.finish).not.toHaveBeenCalled();
		spy.mockRestore();
	});

	it("finish tira: fail fallo_guardado", async () => {
		const store = fakeStore();
		store.finish.mockRejectedValue(new Error("pg detail"));
		const spy = vi.spyOn(console, "error").mockImplementation(() => {});
		await run(store, proposal(true));
		expect(store.fail).toHaveBeenCalledWith("t1", "fallo_guardado");
		spy.mockRestore();
	});

	it("output undefined: fail sin_salida", async () => {
		const store = fakeStore();
		await run(store, undefined);
		expect(store.fail).toHaveBeenCalledWith("t1", "sin_salida");
	});

	it("un store que tira no hace tirar la función", async () => {
		const store = fakeStore();
		store.start.mockRejectedValue(new Error("db caída"));
		store.fail.mockRejectedValue(new Error("db caída"));
		vi.spyOn(console, "error").mockImplementation(() => {});
		await expect(run(store, proposal(true))).resolves.toBeUndefined();
	});
});

describe("createResearchStore", () => {
	function fakeAdmin(selected: unknown = null) {
		const calls: { op: string; payload?: unknown; eq?: unknown }[] = [];
		const admin = {
			from(table: string) {
				expect(table).toBe("onboarding_research");
				return {
					upsert: async (payload: unknown) => {
						calls.push({ op: "upsert", payload });
						return { error: null };
					},
					update: (payload: unknown) => ({
						eq: async (col: string, val: string) => {
							calls.push({ op: "update", payload, eq: [col, val] });
							return { error: null };
						},
					}),
					select: () => ({
						eq: () => ({
							maybeSingle: async () => ({ data: selected, error: null }),
						}),
					}),
				};
			},
		};
		return { admin, calls };
	}

	it("running → done / error", async () => {
		const { admin, calls } = fakeAdmin();
		// biome-ignore lint/suspicious/noExplicitAny: fake del cliente
		const store = createResearchStore(admin as any);
		await store.start("t1", "hint");
		await store.finish("t1", proposal(true));
		await store.fail("t1", "boom");
		expect(calls[0]).toMatchObject({
			op: "upsert",
			payload: {
				tenant_id: "t1",
				status: "running",
				hint: "hint",
				result: null,
				error: null,
			},
		});
		expect(calls[1]).toMatchObject({
			op: "update",
			eq: ["tenant_id", "t1"],
			payload: { status: "done", error: null },
		});
		expect(calls[2]).toMatchObject({
			op: "update",
			payload: { status: "error", error: "boom" },
		});
	});

	it("read devuelve null si no hay fila y la fila mapeada si hay", async () => {
		expect(
			await createResearchStore(fakeAdmin().admin as any).read("t1"),
		).toBeNull();
		const row = {
			status: "done",
			hint: null,
			result: proposal(true),
			error: null,
			updated_at: "2026-10-22T00:00:00Z",
		};
		// biome-ignore lint/suspicious/noExplicitAny: fake del cliente
		const read = await createResearchStore(fakeAdmin(row).admin as any).read(
			"t1",
		);
		expect(read).toMatchObject({ status: "done", updatedAt: row.updated_at });
	});
});
