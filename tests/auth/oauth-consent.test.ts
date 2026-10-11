import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
	allowed: true,
	check: "allowed" as "allowed" | "denied" | "no-tenants",
	details: vi.fn(),
	approve: vi.fn(),
	redirects: [] as string[],
}));

vi.mock("next/navigation", () => ({
	redirect: (url: string) => {
		state.redirects.push(url);
		throw new Error(`REDIRECT ${url}`);
	},
}));

vi.mock("@/lib/supabase/server", () => ({
	createServerSupabase: async () => ({
		auth: {
			getUser: async () => ({ data: { user: { id: "u1" } } }),
			oauth: {
				getAuthorizationDetails: state.details,
				approveAuthorization: state.approve,
				denyAuthorization: vi.fn(),
			},
		},
	}),
}));

vi.mock("@/lib/tenants/login-check-server", () => ({
	consentAllowsLogin: async () => state.allowed,
	consentLoginCheck: async () => state.check,
}));

const { default: ConsentPage } = await import("@/app/oauth/consent/page");
const { approveConsent } = await import("@/app/oauth/consent/actions");

beforeEach(() => {
	state.allowed = true;
	state.check = "allowed";
	state.redirects = [];
	state.details.mockReset();
	state.approve.mockReset();
	state.details.mockResolvedValue({
		data: {
			authorization_id: "a1",
			redirect_uri: "https://claude.ai/cb",
			client: { name: "Claude" },
			user: { id: "u1", email: "ana@acme.com" },
			scope: "openid",
		},
		error: null,
	});
});

const page = async () =>
	renderToStaticMarkup(
		await ConsentPage({
			searchParams: Promise.resolve({ authorization_id: "a1" }),
		}),
	);

describe("/oauth/consent y el método de la sesión", () => {
	it("con un método permitido en todas sus empresas, muestra el pedido", async () => {
		expect(await page()).toContain("Claude quiere conectarse");
	});

	it("con un método que alguna empresa no permite, no lee el pedido (que aprobaría solo un consentimiento previo)", async () => {
		state.check = "denied";
		const html = await page();
		expect(html).toContain("No podés conectar con esta sesión");
		expect(html).toContain("alguna de tus empresas no permite");
		expect(state.details).not.toHaveBeenCalled();
	});

	it("sin empresas activas, no lee el pedido y lo dice con otras palabras", async () => {
		state.check = "no-tenants";
		const html = await page();
		expect(html).toContain("Todavía no estás en ninguna empresa activa");
		expect(html).not.toContain("alguna de tus empresas no permite");
		expect(state.details).not.toHaveBeenCalled();
	});

	it("la acción de permitir aplica el mismo corte aunque se llame sin la página", async () => {
		state.allowed = false;
		const form = new FormData();
		form.set("authorization_id", "a1");
		await expect(approveConsent(form)).rejects.toThrow("REDIRECT");
		expect(state.approve).not.toHaveBeenCalled();
		expect(state.redirects).toEqual(["/oauth/consent?authorization_id=a1"]);
	});
});
