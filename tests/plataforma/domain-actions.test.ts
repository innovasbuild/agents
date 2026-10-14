import { beforeEach, describe, expect, it, vi } from "vitest";

const TENANT = "11111111-1111-4111-8111-111111111111";
const OTHER = "33333333-3333-4333-8333-333333333333";
const DOMAIN = "22222222-2222-4222-8222-222222222222";

const state = vi.hoisted(() => ({
	admin: true,
	rows: {} as Record<string, { tenantId: string }>,
	revalidated: [] as string[],
	calls: [] as { fn: string; args: unknown[] }[],
	result: { ok: true, message: "listo" } as
		| { ok: true; message: string }
		| { ok: false; message: string },
	throws: false,
}));

vi.mock("next/cache", () => ({
	revalidatePath: (path: string) => {
		state.revalidated.push(path);
	},
}));
vi.mock("@/lib/tenants/platform", () => ({
	requirePlatformAdmin: async () =>
		state.admin ? { supabase: {}, userId: "u1" } : null,
}));
vi.mock("@/lib/domains/runtime", () => ({
	domainDeps: () => ({
		store: { get: async (id: string) => state.rows[id] ?? null },
	}),
}));
vi.mock("@/lib/domains/service", () => {
	const record =
		(fn: string) =>
		async (...args: unknown[]) => {
			state.calls.push({ fn, args });
			if (state.throws) throw new Error("base caída");
			return state.result;
		};
	return {
		addDomain: record("add"),
		verifyDomain: record("verify"),
		setPrimaryDomain: record("primary"),
		removeDomain: record("remove"),
	};
});

const actions = await import("@/app/plataforma/[slug]/domain-actions");

beforeEach(() => {
	state.admin = true;
	state.rows = { [DOMAIN]: { tenantId: TENANT } };
	state.revalidated = [];
	state.calls = [];
	state.result = { ok: true, message: "listo" };
	state.throws = false;
});

describe("acciones de dominios de la consola", () => {
	it("solo plataforma: sin permiso no corre nada", async () => {
		state.admin = false;
		for (const out of [
			await actions.addTenantDomain("okeefe", TENANT, "ai.okeefe.com.ar"),
			await actions.verifyTenantDomain("okeefe", TENANT, DOMAIN),
			await actions.makeTenantDomainPrimary("okeefe", TENANT, DOMAIN),
			await actions.removeTenantDomain("okeefe", TENANT, DOMAIN),
		]) {
			expect(out).toEqual({ ok: false, message: "No tenés permiso." });
		}
		expect(state.calls).toEqual([]);
		expect(state.revalidated).toEqual([]);
	});

	it("un id que no es un uuid es un pedido inválido", async () => {
		expect(
			await actions.addTenantDomain("okeefe", "no-es-uuid", "ai.okeefe.com.ar"),
		).toEqual({ ok: false, message: "No se pudo procesar el pedido." });
		expect(
			await actions.removeTenantDomain("okeefe", TENANT, "tampoco"),
		).toEqual({ ok: false, message: "No se pudo procesar el pedido." });
		expect(state.calls).toEqual([]);
	});

	it("agrega el dominio con la persona que opera y revalida la consola", async () => {
		const out = await actions.addTenantDomain(
			"okeefe",
			TENANT,
			"ai.okeefe.com.ar",
		);
		expect(out).toEqual({ ok: true, message: "listo" });
		expect(state.calls).toEqual([
			{
				fn: "add",
				args: [
					expect.anything(),
					{
						tenantId: TENANT,
						rawHostname: "ai.okeefe.com.ar",
						actorUserId: "u1",
					},
				],
			},
		]);
		expect(state.revalidated).toEqual(["/plataforma", "/plataforma/okeefe"]);
	});

	it.each([
		["verifyTenantDomain", "verify"],
		["makeTenantDomainPrimary", "primary"],
		["removeTenantDomain", "remove"],
	] as const)("%s corre sobre un dominio de la empresa", async (action, fn) => {
		const out = await actions[action]("okeefe", TENANT, DOMAIN);
		expect(out.ok).toBe(true);
		expect(state.calls.map((c) => c.fn)).toEqual([fn]);
	});

	it("un dominio de otra empresa no se toca", async () => {
		state.rows = { [DOMAIN]: { tenantId: OTHER } };
		for (const action of [
			actions.verifyTenantDomain,
			actions.makeTenantDomainPrimary,
			actions.removeTenantDomain,
		]) {
			expect(await action("okeefe", TENANT, DOMAIN)).toEqual({
				ok: false,
				message: "No existe ese dominio.",
			});
		}
		expect(state.calls).toEqual([]);
	});

	it("un error del servicio se muestra y no se propaga ni filtra el motivo", async () => {
		const error = vi.spyOn(console, "error").mockImplementation(() => {});
		state.throws = true;
		const out = await actions.verifyTenantDomain("okeefe", TENANT, DOMAIN);
		expect(out).toEqual({
			ok: false,
			message: "No se pudo completar. Probá de nuevo.",
		});
		error.mockRestore();
	});

	it("lo que el servicio responde con error llega tal cual", async () => {
		state.result = { ok: false, message: "Ese dominio ya está cargado." };
		const out = await actions.addTenantDomain(
			"okeefe",
			TENANT,
			"ai.okeefe.com.ar",
		);
		expect(out).toEqual({ ok: false, message: "Ese dominio ya está cargado." });
	});
});
