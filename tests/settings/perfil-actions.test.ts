import { beforeEach, describe, expect, it, vi } from "vitest";

const TENANT = "11111111-1111-4111-8111-111111111111";

const state = vi.hoisted(() => ({
	access: {
		id: "11111111-1111-4111-8111-111111111111",
		slug: "acme",
		role: "tenant_admin",
		userId: "me",
	} as { id: string; slug: string; role: string; userId: string } | null,
	tenantRow: { display_name: "Acme", brand: { logo_url: "acme/old.png" } } as {
		display_name: string;
		brand: Record<string, unknown>;
	} | null,
	rpc: { error: null } as {
		error: { code?: string; message: string; hint?: string } | null;
	},
	method: null as string | null,
	rpcCalls: [] as { fn: string; args: Record<string, unknown> }[],
	uploads: [] as { path: string; type: string }[],
	uploadError: null as { message: string } | null,
}));

vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("@/lib/tenants/resolve", () => ({
	resolveTenantAccess: async () => state.access,
}));
vi.mock("@/lib/tenants/login-check-server", () => ({
	actionAllowsLogin: async () => true,
}));
vi.mock("@/lib/supabase/server", () => ({
	createServerSupabase: async () => ({
		rpc: async (fn: string, args: Record<string, unknown>) => {
			if (fn === "current_login_method")
				return { data: state.method, error: null };
			state.rpcCalls.push({ fn, args });
			return state.rpc;
		},
		from: () => ({
			select: () => ({
				eq: () => ({
					single: async () =>
						state.tenantRow
							? { data: state.tenantRow, error: null }
							: { data: null, error: { message: "x" } },
				}),
			}),
		}),
		storage: {
			from: (bucket: string) => ({
				upload: async (path: string, file: File) => {
					expect(bucket).toBe("brand");
					state.uploads.push({ path, type: file.type });
					return { error: state.uploadError };
				},
			}),
		},
	}),
}));

const actions = await import("@/app/[tenant]/settings/perfil-actions");

const file = (type: string, size: number, name = "logo") =>
	new File([new Uint8Array(size)], name, { type });
const form = (f: File) => {
	const fd = new FormData();
	fd.set("logo", f);
	return fd;
};

beforeEach(() => {
	state.method = null;
	state.access = {
		id: TENANT,
		slug: "acme",
		role: "tenant_admin",
		userId: "me",
	};
	state.tenantRow = {
		display_name: "Acme",
		brand: { logo_url: "acme/old.png" },
	};
	state.rpc = { error: null };
	state.rpcCalls = [];
	state.uploads = [];
	state.uploadError = null;
});

describe("saveProfile", () => {
	it("llama set_tenant_profile con el nombre y la marca mezclada (conserva el logo)", async () => {
		const r = await actions.saveProfile("acme", {
			displayName: " Acme SA ",
			primary: "#112233",
			secondary: "",
		});
		expect(r).toEqual({ ok: true });
		expect(state.rpcCalls).toEqual([
			{
				fn: "set_tenant_profile",
				args: {
					p_tenant: TENANT,
					p_display_name: "Acme SA",
					p_brand: { logo_url: "acme/old.png", primary: "#112233" },
				},
			},
		]);
	});

	it("un nombre de 81 caracteres es INVALIDO y no llama a la base", async () => {
		const r = await actions.saveProfile("acme", {
			displayName: "a".repeat(81),
			primary: "",
			secondary: "",
		});
		expect(r).toEqual({ ok: false, message: "No se pudo procesar el pedido." });
		expect(state.rpcCalls).toHaveLength(0);
	});

	it("un color inválido es INVALIDO", async () => {
		const r = await actions.saveProfile("acme", {
			displayName: "Acme",
			primary: "rojo",
			secondary: "",
		});
		expect(r.ok).toBe(false);
		expect(state.rpcCalls).toHaveLength(0);
	});

	it("un miembro no llega a la base", async () => {
		state.access = {
			id: TENANT,
			slug: "acme",
			role: "tenant_member",
			userId: "me",
		};
		const r = await actions.saveProfile("acme", {
			displayName: "Acme",
			primary: "",
			secondary: "",
		});
		expect(r).toEqual({ ok: false, message: "No tenés permiso." });
		expect(state.rpcCalls).toHaveLength(0);
	});
});

describe("saveLogo", () => {
	it("un PNG de 2 MB no se sube", async () => {
		const r = await actions.saveLogo(
			"acme",
			form(file("image/png", 2_000_000)),
		);
		expect(r.ok).toBe(false);
		expect(state.uploads).toHaveLength(0);
		expect(state.rpcCalls).toHaveLength(0);
	});

	it("un SVG de 10 KB se sube a acme/logo-….svg y se guarda en brand.logo_url", async () => {
		const r = await actions.saveLogo(
			"acme",
			form(file("image/svg+xml", 10_000)),
		);
		expect(r).toEqual({ ok: true });
		expect(state.uploads).toHaveLength(1);
		expect(state.uploads[0]?.path).toMatch(/^acme\/logo-\d+\.svg$/);
		const call = state.rpcCalls[0];
		expect(call?.fn).toBe("set_tenant_profile");
		expect(call?.args.p_display_name).toBe("Acme");
		expect(call?.args.p_brand).toEqual({ logo_url: state.uploads[0]?.path });
	});

	it("si la subida falla no toca el perfil", async () => {
		state.uploadError = { message: "boom" };
		const r = await actions.saveLogo("acme", form(file("image/png", 100)));
		expect(r).toEqual({ ok: false, message: "No se pudo subir el logo." });
		expect(state.rpcCalls).toHaveLength(0);
	});
});

describe("saveAuthMethods", () => {
	it("llama set_tenant_auth_methods", async () => {
		const r = await actions.saveAuthMethods("acme", ["microsoft", "email"]);
		expect(r).toEqual({ ok: true });
		expect(state.rpcCalls).toEqual([
			{
				fn: "set_tenant_auth_methods",
				args: { p_tenant: TENANT, p_methods: ["microsoft", "email"] },
			},
		]);
	});

	it("rechaza sacar el método de la sesión sin llamar a la base", async () => {
		state.method = "google";
		expect(await actions.saveAuthMethods("acme", ["email"])).toEqual({
			ok: false,
			message:
				"No podés sacar la forma de entrar con la que estás usando ahora.",
		});
		expect(state.rpcCalls).toHaveLength(0);
	});

	it("plataforma está exenta", async () => {
		state.method = "google";
		state.access = {
			id: TENANT,
			slug: "acme",
			role: "platform_admin",
			userId: "me",
		};
		expect(await actions.saveAuthMethods("acme", ["email"])).toEqual({
			ok: true,
		});
	});

	it("métodos vacíos: devuelve el mensaje de la base (hint settings)", async () => {
		state.rpc = {
			error: {
				code: "23514",
				message: "dejá al menos una forma de entrar",
				hint: "settings",
			},
		};
		expect(await actions.saveAuthMethods("acme", [])).toEqual({
			ok: false,
			message: "dejá al menos una forma de entrar",
		});
	});
});

describe("saveAiMonthlyLimit", () => {
	it("llama set_ai_monthly_limit con el número o null", async () => {
		await actions.saveAiMonthlyLimit("acme", 25);
		await actions.saveAiMonthlyLimit("acme", null);
		expect(state.rpcCalls.map((c) => [c.fn, c.args.p_limit])).toEqual([
			["set_ai_monthly_limit", 25],
			["set_ai_monthly_limit", null],
		]);
	});

	it("un negativo es INVALIDO", async () => {
		expect((await actions.saveAiMonthlyLimit("acme", -1)).ok).toBe(false);
		expect(state.rpcCalls).toHaveLength(0);
	});
});
