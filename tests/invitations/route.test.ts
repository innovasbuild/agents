import { beforeEach, describe, expect, it, vi } from "vitest";

const TENANT_ID = "11111111-1111-4111-8111-111111111111";

const state: {
	user: { id: string } | null;
	membership: { role: string } | null;
	platformAdmin: boolean;
	outcome: { kind: string; allowedDomains?: string[] };
	calls: Record<string, unknown>[];
} = {
	user: { id: "u1" },
	membership: { role: "tenant_admin" },
	platformAdmin: false,
	outcome: { kind: "ok" },
	calls: [],
};

vi.mock("@/lib/supabase/server", () => ({
	createServerSupabase: async () => {
		const builder = {
			select: () => builder,
			eq: () => builder,
			in: () => builder,
			maybeSingle: async () => ({ data: state.membership }),
		};
		return {
			auth: { getUser: async () => ({ data: { user: state.user } }) },
			from: () => builder,
			rpc: async () => ({ data: state.platformAdmin }),
		};
	},
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({}) }));
vi.mock("@/lib/invitations/invite", () => ({
	inviteToTenant: async (params: Record<string, unknown>) => {
		state.calls.push(params);
		return state.outcome;
	},
}));

const { POST } = await import("@/app/api/invitations/route");

const request = (body: unknown) =>
	new Request("https://app.test/api/invitations", {
		method: "POST",
		body: typeof body === "string" ? body : JSON.stringify(body),
	});

const valid = {
	tenantId: TENANT_ID,
	email: "Ana@Acme.test",
	role: "tenant_member",
};

describe("POST /api/invitations", () => {
	beforeEach(() => {
		state.user = { id: "u1" };
		state.membership = { role: "tenant_admin" };
		state.platformAdmin = false;
		state.outcome = { kind: "ok" };
		state.calls = [];
	});

	it("401 sin sesión", async () => {
		state.user = null;

		expect((await POST(request(valid))).status).toBe(401);
	});

	it("400 con un body que no es JSON", async () => {
		expect((await POST(request("no-json"))).status).toBe(400);
	});

	it("400 con un payload inválido", async () => {
		expect(
			(await POST(request({ ...valid, role: "platform_admin" }))).status,
		).toBe(400);
	});

	it("403 sin ser admin del tenant ni platform_admin", async () => {
		state.membership = null;

		expect((await POST(request(valid))).status).toBe(403);
		expect(state.calls).toHaveLength(0);
	});

	it("deja pasar a un platform_admin sin membership en el tenant", async () => {
		state.membership = null;
		state.platformAdmin = true;

		expect((await POST(request(valid))).status).toBe(201);
	});

	it("le pasa al helper el correo normalizado, el origen y quién invita", async () => {
		await POST(request(valid));

		expect(state.calls[0]).toMatchObject({
			tenantId: TENANT_ID,
			email: "ana@acme.test",
			role: "tenant_member",
			invitedBy: "u1",
			allowExternal: false,
			origin: "https://app.test",
		});
	});

	it("404 si el tenant no existe", async () => {
		state.outcome = { kind: "tenant_inexistente" };

		expect((await POST(request(valid))).status).toBe(404);
	});

	it("422 con la lista de dominios cuando el correo es externo", async () => {
		state.outcome = {
			kind: "dominio_no_permitido",
			allowedDomains: ["acme.test"],
		};

		const response = await POST(request(valid));

		expect(response.status).toBe(422);
		expect(await response.json()).toEqual({
			error: "dominio_no_permitido",
			allowedDomains: ["acme.test"],
		});
	});

	it("409 si ya hay una invitación pendiente", async () => {
		state.outcome = { kind: "duplicada" };

		expect((await POST(request(valid))).status).toBe(409);
	});

	it("502 si no salió el mail", async () => {
		state.outcome = { kind: "mail_fallo" };

		expect((await POST(request(valid))).status).toBe(502);
	});

	it("201 tanto si invitó como si el usuario ya existía", async () => {
		expect((await POST(request(valid))).status).toBe(201);
		state.outcome = { kind: "ya_existe" };
		expect((await POST(request(valid))).status).toBe(201);
	});
});
