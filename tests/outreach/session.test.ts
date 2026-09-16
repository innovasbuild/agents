import { describe, expect, it } from "vitest";
import { isRefusal, refuse } from "@/lib/outreach/result";
import { callerFromSession } from "@/lib/outreach/session";

const user = {
	principalType: "user",
	principalId: "u1",
	attributes: { tenantId: "t1", role: "tenant_member", email: "ana@acme.test" },
};

describe("callerFromSession", () => {
	it("lee tenant, usuario, rol y email del caller actual", () => {
		expect(
			callerFromSession({ auth: { current: user, initiator: null } }),
		).toEqual({
			tenantId: "t1",
			userId: "u1",
			role: "tenant_member",
			email: "ana@acme.test",
		});
	});
	it("usa el initiator si no hay current", () => {
		expect(
			callerFromSession({ auth: { current: null, initiator: user } }).userId,
		).toBe("u1");
	});
	it("sin usuario o sin tenant es un error de canal, no una negativa", () => {
		expect(() =>
			callerFromSession({
				auth: {
					current: {
						principalType: "runtime",
						principalId: "eve:app",
						attributes: {},
					},
					initiator: null,
				},
			}),
		).toThrow("la tool requiere un usuario autenticado");
		expect(() =>
			callerFromSession({
				auth: { current: { ...user, attributes: {} }, initiator: null },
			}),
		).toThrow("la sesión no tiene tenant");
	});
});

describe("refuse", () => {
	it("arma una negativa citable", () => {
		const r = refuse("claim_ajeno", "esta persona la tiene otro ejecutor");
		expect(r).toEqual({
			ok: false,
			reason: "claim_ajeno",
			message: "esta persona la tiene otro ejecutor",
		});
		expect(isRefusal(r)).toBe(true);
		expect(isRefusal({ ok: true })).toBe(false);
	});
});
