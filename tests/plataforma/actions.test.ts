import { beforeEach, describe, expect, it, vi } from "vitest";

const TENANT_ID = "11111111-1111-4111-8111-111111111111";

const state: {
	admin: boolean;
	adminRedirects: boolean;
	loginMethod: { data: unknown; error: unknown };
	loginMethodThrows: boolean;
	rpcCalls: string[];
	current: unknown;
	updateResult: { data: unknown; error: unknown };
	uploadError: unknown;
	updates: Record<string, unknown>[];
	uploads: { path: string; contentType?: string }[];
} = {
	admin: true,
	adminRedirects: false,
	loginMethod: { data: "email", error: null },
	loginMethodThrows: false,
	rpcCalls: [],
	current: null,
	updateResult: { data: { id: TENANT_ID }, error: null },
	uploadError: null,
	updates: [],
	uploads: [],
};

// Lo que tira `redirect()` de Next: no es una falla, es el control de flujo.
const REDIRECT = Object.assign(new Error("NEXT_REDIRECT"), {
	digest: "NEXT_REDIRECT;replace;/login/innovas?error=metodo;307;",
});

const supabase = {
	rpc: async (fn: string) => {
		state.rpcCalls.push(fn);
		if (state.loginMethodThrows) throw new Error("red");
		return state.loginMethod;
	},
	from: () => ({
		select: () => ({
			eq: () => ({ maybeSingle: async () => ({ data: state.current }) }),
		}),
		update(values: Record<string, unknown>) {
			state.updates.push(values);
			return {
				eq: () => ({
					select: () => ({ maybeSingle: async () => state.updateResult }),
				}),
			};
		},
	}),
	storage: {
		from: () => ({
			upload: async (
				path: string,
				_file: unknown,
				options: { contentType?: string },
			) => {
				state.uploads.push({ path, contentType: options.contentType });
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
	platformOwnerSlug: () => "innovas",
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const { updateTenant } = await import("@/app/plataforma/[slug]/actions");

function form(overrides: Record<string, string | File | null> = {}) {
	const values: Record<string, string | File | null> = {
		display_name: "Demo",
		allowed_domains: "demo.test",
		allowed_models: "anthropic/claude-sonnet-5",
		default_model: "anthropic/claude-sonnet-5",
		auth_methods: "email",
		primary: "#059669",
		secondary: "",
		active: "on",
		...overrides,
	};
	const data = new FormData();
	for (const [key, value] of Object.entries(values)) {
		if (value !== null) data.set(key, value);
	}
	return data;
}

describe("updateTenant", () => {
	beforeEach(() => {
		state.admin = true;
		state.adminRedirects = false;
		state.loginMethod = { data: "email", error: null };
		state.loginMethodThrows = false;
		state.rpcCalls = [];
		state.current = {
			id: TENANT_ID,
			slug: "demo",
			brand: { primary: "#000000", logo_url: "demo/logo.png", font: "Geist" },
		};
		state.updateResult = { data: { id: TENANT_ID }, error: null };
		state.uploadError = null;
		state.updates = [];
		state.uploads = [];
	});

	it("rechaza a quien no es platform_admin sin tocar la base", async () => {
		state.admin = false;

		const result = await updateTenant(TENANT_ID, form());

		expect(result).toEqual({ ok: false, message: "No tenés permiso." });
		expect(state.updates).toHaveLength(0);
	});

	it("rechaza un tenantId que no es uuid", async () => {
		const result = await updateTenant("no-es-uuid", form());

		expect(result.ok).toBe(false);
		expect(state.updates).toHaveLength(0);
	});

	it("devuelve el mensaje del campo inválido sin tocar la base", async () => {
		const result = await updateTenant(TENANT_ID, form({ display_name: "" }));

		expect(result).toEqual({
			ok: false,
			message: "El nombre no puede quedar vacío.",
		});
		expect(state.updates).toHaveLength(0);
	});

	it("escribe las columnas del formulario y mezcla brand", async () => {
		const result = await updateTenant(TENANT_ID, form());

		expect(result).toEqual({ ok: true });
		expect(state.updates[0]).toEqual({
			display_name: "Demo",
			allowed_domains: ["demo.test"],
			self_signup_by_domain: false,
			allowed_models: ["anthropic/claude-sonnet-5"],
			default_model: "anthropic/claude-sonnet-5",
			auth_methods: ["email"],
			active: true,
			brand: { primary: "#059669", logo_url: "demo/logo.png", font: "Geist" },
		});
	});

	it("nunca escribe el slug", async () => {
		await updateTenant(TENANT_ID, form());

		expect(state.updates[0]).not.toHaveProperty("slug");
	});

	it("rechaza desactivar el tenant dueño", async () => {
		state.current = { id: TENANT_ID, slug: "innovas", brand: {} };

		const result = await updateTenant(TENANT_ID, form({ active: null }));

		expect(result).toEqual({
			ok: false,
			message: "El tenant dueño de la plataforma no se puede desactivar.",
		});
		expect(state.updates).toHaveLength(0);
	});

	it("deja desactivar otro tenant", async () => {
		const result = await updateTenant(TENANT_ID, form({ active: null }));

		expect(result).toEqual({ ok: true });
		expect(state.updates[0]?.active).toBe(false);
	});

	it("no toca el logo cuando el input de archivo llega vacío", async () => {
		await updateTenant(TENANT_ID, form({ logo: new File([], "") }));

		expect(state.uploads).toHaveLength(0);
		expect(state.updates[0]?.brand).toMatchObject({
			logo_url: "demo/logo.png",
		});
	});

	it("sube el logo nuevo a la carpeta del slug y guarda su path", async () => {
		const logo = new File(["png"], "marca.png", { type: "image/png" });

		await updateTenant(TENANT_ID, form({ logo }));

		expect(state.uploads).toHaveLength(1);
		expect(state.uploads[0]?.path).toMatch(/^demo\/logo-\d+\.png$/);
		expect(state.uploads[0]?.contentType).toBe("image/png");
		expect(state.updates[0]?.brand).toMatchObject({
			logo_url: state.uploads[0]?.path,
		});
	});

	it("rechaza un logo de tipo no permitido sin subir nada", async () => {
		const logo = new File(["x"], "marca.jpg", { type: "image/jpeg" });

		const result = await updateTenant(TENANT_ID, form({ logo }));

		expect(result).toEqual({
			ok: false,
			message: "El logo tiene que ser PNG, SVG o WebP.",
		});
		expect(state.uploads).toHaveLength(0);
		expect(state.updates).toHaveLength(0);
	});

	it("no guarda si la subida del logo falla", async () => {
		state.uploadError = { message: "boom" };
		const logo = new File(["png"], "marca.png", { type: "image/png" });

		const result = await updateTenant(TENANT_ID, form({ logo }));

		expect(result).toEqual({ ok: false, message: "No se pudo subir el logo." });
		expect(state.updates).toHaveLength(0);
	});

	it("contesta sin permiso si el tenant no se puede leer", async () => {
		state.current = null;

		const result = await updateTenant(TENANT_ID, form());

		expect(result).toEqual({ ok: false, message: "No tenés permiso." });
	});

	it("contesta sin permiso si la RLS filtró el update (sin error, sin fila)", async () => {
		state.updateResult = { data: null, error: null };

		const result = await updateTenant(TENANT_ID, form());

		expect(result).toEqual({ ok: false, message: "No tenés permiso." });
	});

	it("contesta un mensaje genérico si la base devuelve error", async () => {
		state.updateResult = { data: null, error: { code: "23514" } };

		const result = await updateTenant(TENANT_ID, form());

		expect(result).toEqual({
			ok: false,
			message: "No se pudieron guardar los cambios.",
		});
	});

	it("deja pasar el redirect de requirePlatformAdmin en vez de taparlo con un error genérico", async () => {
		state.adminRedirects = true;

		await expect(updateTenant(TENANT_ID, form())).rejects.toBe(REDIRECT);
		expect(state.updates).toHaveLength(0);
	});

	describe("métodos de ingreso del tenant dueño", () => {
		const SIN_EL_PROPIO = {
			ok: false,
			message:
				"No podés sacarle al tenant dueño el método con el que entraste: te quedarías sin acceso a la consola.",
		};
		const owner = () => {
			state.current = { id: TENANT_ID, slug: "innovas", brand: {} };
		};

		it("no guarda si la lista nueva deja afuera el método de la sesión", async () => {
			owner();
			state.loginMethod = { data: "google", error: null };

			const result = await updateTenant(
				TENANT_ID,
				form({ auth_methods: "microsoft" }),
			);

			expect(result).toEqual(SIN_EL_PROPIO);
			expect(state.rpcCalls).toEqual(["current_login_method"]);
			expect(state.updates).toHaveLength(0);
		});

		it("no sube el logo si después no va a guardar", async () => {
			owner();
			state.loginMethod = { data: "google", error: null };
			const logo = new File(["png"], "marca.png", { type: "image/png" });

			await updateTenant(TENANT_ID, form({ auth_methods: "email", logo }));

			expect(state.uploads).toHaveLength(0);
		});

		it("guarda si la lista nueva conserva el método de la sesión", async () => {
			owner();
			state.loginMethod = { data: "google", error: null };
			const data = form({ auth_methods: "microsoft" });
			data.append("auth_methods", "google");

			const result = await updateTenant(TENANT_ID, data);

			expect(result).toEqual({ ok: true });
			expect(state.updates[0]?.auth_methods).toEqual(["microsoft", "google"]);
		});

		it("no guarda si no se puede saber el método: error del RPC", async () => {
			owner();
			state.loginMethod = { data: "email", error: { message: "boom" } };
			const error = vi.spyOn(console, "error").mockImplementation(() => {});

			expect(await updateTenant(TENANT_ID, form())).toEqual(SIN_EL_PROPIO);
			expect(state.updates).toHaveLength(0);
			expect(error).toHaveBeenCalled();
			error.mockRestore();
		});

		it("no guarda si no se puede saber el método: el RPC tira", async () => {
			owner();
			state.loginMethodThrows = true;
			const error = vi.spyOn(console, "error").mockImplementation(() => {});

			expect(await updateTenant(TENANT_ID, form())).toEqual(SIN_EL_PROPIO);
			expect(state.updates).toHaveLength(0);
			error.mockRestore();
		});

		it.each([null, undefined, "", 7])(
			"no guarda si el método de la sesión no se reconoce (%s)",
			async (data) => {
				owner();
				state.loginMethod = { data, error: null };

				expect(await updateTenant(TENANT_ID, form())).toEqual(SIN_EL_PROPIO);
				expect(state.updates).toHaveLength(0);
			},
		);

		it("en otro tenant no consulta el método y guarda", async () => {
			state.loginMethod = { data: "google", error: null };

			const result = await updateTenant(
				TENANT_ID,
				form({ auth_methods: "microsoft" }),
			);

			expect(result).toEqual({ ok: true });
			expect(state.rpcCalls).toHaveLength(0);
			expect(state.updates[0]?.auth_methods).toEqual(["microsoft"]);
		});
	});
});
