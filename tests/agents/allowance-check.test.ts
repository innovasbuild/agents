import { describe, expect, it, vi } from "vitest";
import {
	allowanceReasonFrom,
	checkTurnAllowance,
} from "../../lib/agents/allowance-check";
import type { AiAllowance, AllowanceStore } from "../../lib/plans/ai-allowance";

const store = {} as AllowanceStore;
const makeStore = () => store;
const now = () => new Date("2026-10-22T12:00:00Z");

function run(
	tenantId: string | null,
	allowance: () => Promise<AiAllowance>,
	factory: () => AllowanceStore = makeStore,
) {
	const fn = vi.fn(allowance);
	return {
		fn,
		done: checkTurnAllowance(
			{ tenantId },
			{ allowance: fn as never, makeStore: factory, now },
		),
	};
}

describe("checkTurnAllowance", () => {
	it("free con el crédito agotado corta el turno", async () => {
		const { done } = run("t1", async () => ({
			ok: false,
			reason: "limit:ai_credit",
			spent: 5,
			limit: 5,
		}));
		await expect(done).rejects.toThrow("ai_allowance:limit:ai_credit");
	});

	it("con crédito resuelve", async () => {
		const { fn, done } = run("t1", async () => ({
			ok: true,
			spent: 1,
			limit: 5,
		}));
		await expect(done).resolves.toBeUndefined();
		expect(fn).toHaveBeenCalledWith({ tenantId: "t1" }, { store, now });
	});

	it("sin empresa no consulta nada", async () => {
		const { fn, done } = run(null, async () => {
			throw new Error("no debería llamarse");
		});
		await expect(done).resolves.toBeUndefined();
		expect(fn).not.toHaveBeenCalled();
	});

	it("una empresa suspendida corta con el motivo", async () => {
		const { done } = run("t1", async () => ({
			ok: false,
			reason: "suspended:trial_vencido",
			spent: 0,
			limit: null,
		}));
		await expect(done).rejects.toThrow("ai_allowance:suspended:trial_vencido");
	});

	it("si la lectura de facturación falla, el chat sigue (fail open) y se loguea", async () => {
		const spy = vi.spyOn(console, "error").mockImplementation(() => {});
		const { done } = run("t1", async () => {
			throw new Error("base caída");
		});
		await expect(done).resolves.toBeUndefined();
		expect(spy).toHaveBeenCalled();
		spy.mockRestore();
	});
});

describe("checkTurnAllowance: fábrica del store", () => {
	it("si crear el cliente tira, el turno pasa (fail open) y se loguea", async () => {
		const spy = vi.spyOn(console, "error").mockImplementation(() => {});
		const { done } = run(
			"t1",
			async () => ({ ok: true, spent: 0, limit: null }),
			() => {
				throw new Error("falta SUPABASE_SERVICE_ROLE_KEY");
			},
		);
		await expect(done).resolves.toBeUndefined();
		expect(spy).toHaveBeenCalled();
		spy.mockRestore();
	});
});

describe("allowanceReasonFrom", () => {
	it("extrae el motivo del mensaje de un turn.failed", () => {
		expect(allowanceReasonFrom("ai_allowance:limit:ai_credit")).toBe(
			"limit:ai_credit",
		);
		expect(
			allowanceReasonFrom("Error: ai_allowance:suspended:cancelado (hook)"),
		).toBe("suspended:cancelado");
	});

	it("ignora cualquier otro fallo", () => {
		expect(allowanceReasonFrom("gateway caído")).toBeNull();
		expect(allowanceReasonFrom(undefined)).toBeNull();
	});
});
