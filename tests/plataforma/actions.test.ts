import { beforeEach, describe, expect, it, vi } from "vitest";

const TENANT_ID = "11111111-1111-4111-8111-111111111111";

const state: {
	admin: boolean;
	current: unknown;
	updateResult: { data: unknown; error: unknown };
	uploadError: unknown;
	updates: Record<string, unknown>[];
	uploads: { path: string; contentType?: string }[];
} = {
	admin: true,
	current: null,
	updateResult: { data: { id: TENANT_ID }, error: null },
	uploadError: null,
	updates: [],
	uploads: [],
};

const supabase = {
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
	requirePlatformAdmin: async () =>
		state.admin ? { supabase, userId: "u1" } : null,
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
});
