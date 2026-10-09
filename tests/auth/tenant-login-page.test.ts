import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state: { tenant: unknown } = { tenant: null };

vi.mock("@/lib/tenants/public", async (importOriginal) => ({
	...(await importOriginal<typeof import("@/lib/tenants/public")>()),
	loadPublicTenant: async () => state.tenant,
}));
vi.mock("@/app/(auth)/login/login-form", () => ({
	LoginForm: () => null,
}));
vi.mock("next/navigation", () => ({
	notFound: () => {
		throw new Error("NEXT_NOT_FOUND");
	},
}));

const { default: TenantLoginPage } = await import(
	"@/app/(auth)/login/[tenant]/page"
);

const tenant = (openDomains: string[]) => ({
	slug: "acme",
	displayName: "Acme",
	brand: {},
	authMethods: ["email"],
	logoUrl: null,
	openDomains,
});

const render = async () =>
	renderToStaticMarkup(
		await TenantLoginPage({ params: Promise.resolve({ tenant: "acme" }) }),
	);

describe("landing de la empresa", () => {
	beforeEach(() => {
		state.tenant = tenant([]);
	});

	it("cerrada, pide la cuenta con la que invitaron", async () => {
		expect(await render()).toContain(
			"Entrá con la cuenta con la que te invitaron a Acme.",
		);
	});

	it("abierta, pide el correo del dominio y deja la salida para invitados de afuera", async () => {
		state.tenant = tenant(["acme.com", "acme.com.ar"]);

		const html = await render();

		expect(html).toContain("Entrá con tu correo de @acme.com o @acme.com.ar.");
		expect(html).toContain("Si te invitaron con otro correo, usá ese.");
	});
});
