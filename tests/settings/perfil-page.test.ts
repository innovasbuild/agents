import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = {
	role: "tenant_admin" as string | null,
	method: "google" as string | null,
};

vi.mock("@/lib/tenants/resolve", () => ({
	resolveTenantAccess: async () =>
		state.role === null
			? null
			: {
					id: "t1",
					slug: "acme",
					displayName: "Acme SA",
					role: state.role,
					brand: { primary: "#112233", secondary: "#445566" },
				},
}));
vi.mock("@/lib/supabase/server", () => ({
	createServerSupabase: async () => ({
		from: () => ({
			select: () => ({
				eq: () => ({
					maybeSingle: async () => ({
						data: { auth_methods: ["google", "email"] },
						error: null,
					}),
				}),
			}),
		}),
	}),
}));
vi.mock("@/lib/tenants/session-method", () => ({
	sessionLoginMethod: async () => state.method,
}));
vi.mock("@/app/[tenant]/settings/perfil-actions", () => ({
	saveProfile: async () => ({ ok: true }),
	saveLogo: async () => ({ ok: true }),
	saveAuthMethods: async () => ({ ok: true }),
}));
vi.mock("next/navigation", () => ({
	notFound: () => {
		throw new Error("NEXT_NOT_FOUND");
	},
}));

const { default: PerfilPage } = await import(
	"@/app/[tenant]/settings/perfil/page"
);
const render = async () =>
	renderToStaticMarkup(
		await PerfilPage({ params: Promise.resolve({ tenant: "acme" }) }),
	);

beforeEach(() => {
	state.role = "tenant_admin";
	state.method = "google";
});

describe("pantalla de perfil", () => {
	it("un miembro recibe 404", async () => {
		state.role = "tenant_member";
		await expect(render()).rejects.toThrow("NEXT_NOT_FOUND");
	});

	it("muestra los valores actuales", async () => {
		const html = await render();
		expect(html).toContain('value="Acme SA"');
		expect(html).toContain('value="#112233"');
		expect(html).toContain('value="#445566"');
	});

	it("el método de la sesión queda marcado y deshabilitado", async () => {
		const html = await render();
		expect(html).toContain("Es la que estás usando ahora.");
		expect(html).toMatch(
			/<input[^>]*checked=""[^>]*disabled=""[^>]*>\s*Google|<input[^>]*disabled=""[^>]*checked=""[^>]*>\s*Google/,
		);
	});

	it("plataforma puede sacar cualquier método", async () => {
		state.role = "platform_admin";
		expect(await render()).not.toContain("Es la que estás usando ahora.");
	});
});
