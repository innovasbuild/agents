import { beforeEach, describe, expect, it, vi } from "vitest";

const NEW_ID = "22222222-2222-4222-8222-222222222222";

const state: {
	admin: boolean;
	adminRedirects: boolean;
	rpc: { data: unknown; error: { code?: string; message: string } | null };
	rpcCalls: { fn: string; args: Record<string, unknown> }[];
	updates: Record<string, unknown>[];
	uploads: string[];
	uploadError: unknown;
	updateError: unknown;
	inviteThrows: boolean;
	invite: { kind: string; allowedDomains?: string[] };
	inviteCalls: Record<string, unknown>[];
} = {
	admin: true,
	adminRedirects: false,
	rpc: { data: NEW_ID, error: null },
	rpcCalls: [],
	updates: [],
	uploads: [],
	uploadError: null,
	updateError: null,
	inviteThrows: false,
	invite: { kind: "ok" },
	inviteCalls: [],
};

// Lo que tira `redirect()` de Next: no es una falla, es el control de flujo.
const REDIRECT = Object.assign(new Error("NEXT_REDIRECT"), {
	digest: "NEXT_REDIRECT;replace;/login/innovas?error=metodo;307;",
});

const supabase = {
	rpc: async (fn: string, args: Record<string, unknown>) => {
		state.rpcCalls.push({ fn, args });
		return state.rpc;
	},
	from: () => ({
		update(values: Record<string, unknown>) {
			state.updates.push(values);
			return { eq: async () => ({ error: state.updateError }) };
		},
	}),
	storage: {
		from: () => ({
			upload: async (path: string) => {
				state.uploads.push(path);
				return { error: state.uploadError };
			},
		}),
	},
};

vi.mock("@/lib/tenants/platform", () => ({
	requirePlatformAdmin: async () => {
		if (state.adminRedirects) throw REDIRECT;
		return state.admin ? { supabase, userId: "u1" } : null;
	},
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({}) }));
vi.mock("@/lib/invitations/invite", () => ({
	inviteToTenant: async (params: Record<string, unknown>) => {
		state.inviteCalls.push(params);
		if (state.inviteThrows) throw new Error("boom");
		return state.invite;
	},
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/headers", () => ({
	headers: async () => new Headers({ origin: "https://app.test" }),
}));

const { createTenant } = await import("@/app/plataforma/nueva/actions");

function form(overrides: Record<string, string | File | null> = {}) {
	const values: Record<string, string | File | null> = {
		display_name: "Acme",
		slug: "acme",
		allowed_domains: "acme.test",
		auth_methods: "email",
		primary: "#112233",
		secondary: "",
		admin_email: "ana@acme.test",
		...overrides,
	};
	const data = new FormData();
	for (const [k, v] of Object.entries(values)) if (v !== null) data.set(k, v);
	return data;
}

describe("createTenant", () => {
	beforeEach(() => {
		state.admin = true;
		state.adminRedirects = false;
		state.rpc = { data: NEW_ID, error: null };
		state.rpcCalls = [];
		state.updates = [];
		state.uploads = [];
		state.uploadError = null;
		state.updateError = null;
		state.inviteThrows = false;
		state.invite = { kind: "ok" };
		state.inviteCalls = [];
	});

	it("rechaza a quien no es platform_admin sin tocar la base", async () => {
		state.admin = false;

		expect(await createTenant(form())).toEqual({
			ok: false,
			message: "No tenés permiso.",
		});
		expect(state.rpcCalls).toHaveLength(0);
	});

	it("deja pasar el redirect de requirePlatformAdmin en vez de taparlo con un error genérico", async () => {
		state.adminRedirects = true;

		await expect(createTenant(form())).rejects.toBe(REDIRECT);
		expect(state.rpcCalls).toHaveLength(0);
	});

	it("devuelve el mensaje del campo sin crear nada", async () => {
		const result = await createTenant(form({ admin_email: "ana@gmail.com" }));

		expect(result).toEqual({
			ok: false,
			message:
				'Ese correo no es de los dominios permitidos. Marcá "Permitir correo externo" si es a propósito.',
		});
		expect(state.rpcCalls).toHaveLength(0);
	});

	it("crea la empresa con create_tenant e invita al admin hacia su chat", async () => {
		const result = await createTenant(form());

		expect(result).toEqual({ ok: true, slug: "acme", warnings: [] });
		expect(state.rpcCalls[0]).toEqual({
			fn: "create_tenant",
			args: {
				p_slug: "acme",
				p_display_name: "Acme",
				p_allowed_domains: ["acme.test"],
				p_auth_methods: ["email"],
				p_brand: { primary: "#112233" },
			},
		});
		expect(state.inviteCalls[0]).toMatchObject({
			tenantId: NEW_ID,
			email: "ana@acme.test",
			role: "tenant_admin",
			invitedBy: "u1",
			allowExternal: false,
			origin: "https://app.test",
			next: "/acme/chat",
		});
	});

	it("traduce un slug repetido", async () => {
		state.rpc = { data: null, error: { code: "23505", message: "dup" } };

		expect(await createTenant(form())).toEqual({
			ok: false,
			message: "Ya hay una empresa con ese slug.",
		});
	});

	it("traduce un slug reservado", async () => {
		state.rpc = { data: null, error: { code: "23514", message: "check" } };

		expect(await createTenant(form())).toEqual({
			ok: false,
			message: "Ese slug está reservado o tiene un formato inválido.",
		});
	});

	it("traduce falta de permiso de la RLS", async () => {
		state.rpc = { data: null, error: { code: "42501", message: "rls" } };

		expect(await createTenant(form())).toEqual({
			ok: false,
			message: "No tenés permiso.",
		});
	});

	it("sube el logo después de crear y lo guarda en brand", async () => {
		const logo = new File(["png"], "l.png", { type: "image/png" });

		const result = await createTenant(form({ logo }));

		expect(result.ok).toBe(true);
		expect(state.uploads[0]).toMatch(/^acme\/logo-\d+\.png$/);
		expect(state.updates[0]?.brand).toMatchObject({
			primary: "#112233",
			logo_url: state.uploads[0],
		});
	});

	it("si falla el logo, la empresa queda creada y se avisa", async () => {
		state.uploadError = { message: "boom" };
		const logo = new File(["png"], "l.png", { type: "image/png" });

		const result = await createTenant(form({ logo }));

		expect(result).toEqual({
			ok: true,
			slug: "acme",
			warnings: ["No se pudo subir el logo. Subilo desde esta pantalla."],
		});
		expect(state.inviteCalls).toHaveLength(1);
	});

	it("si falla la invitación, la empresa queda creada y se avisa", async () => {
		state.invite = { kind: "mail_fallo" };

		expect(await createTenant(form())).toEqual({
			ok: true,
			slug: "acme",
			warnings: [
				"No se pudo mandar la invitación al administrador. Invitalo desde Usuarios.",
			],
		});
	});

	it("si el admin ya existía en Auth no es advertencia", async () => {
		state.invite = { kind: "ya_existe" };

		expect(await createTenant(form())).toEqual({
			ok: true,
			slug: "acme",
			warnings: [],
		});
	});

	it("un logo inválido frena antes de crear", async () => {
		const logo = new File(["x"], "l.jpg", { type: "image/jpeg" });

		expect(await createTenant(form({ logo }))).toEqual({
			ok: false,
			message: "El logo tiene que ser PNG, SVG o WebP.",
		});
		expect(state.rpcCalls).toHaveLength(0);
	});

	it("si no se pudo guardar el logo en la marca, avisa", async () => {
		state.updateError = { message: "boom" };
		const logo = new File(["png"], "l.png", { type: "image/png" });

		const result = await createTenant(form({ logo }));

		expect(result).toEqual({
			ok: true,
			slug: "acme",
			warnings: ["No se pudo subir el logo. Subilo desde esta pantalla."],
		});
	});

	it("si algo se rompe después de crear, la empresa creada no se informa como error", async () => {
		state.inviteThrows = true;

		const result = await createTenant(form());

		expect(result).toEqual({
			ok: true,
			slug: "acme",
			warnings: [
				"No se pudo mandar la invitación al administrador. Invitalo desde Usuarios.",
			],
		});
	});
});
