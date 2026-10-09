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

const render = async (error?: string) =>
	renderToStaticMarkup(
		await TenantLoginPage({
			params: Promise.resolve({ tenant: "acme" }),
			searchParams: Promise.resolve(error ? { error } : {}),
		}),
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

	it("con error=metodo avisa que ese método no está permitido", async () => {
		expect(await render("metodo")).toContain(
			"Tu empresa no permite entrar con ese método. Usá una de estas opciones.",
		);
	});

	it("sin error no muestra ningún aviso", async () => {
		expect(await render()).not.toContain('role="alert"');
	});

	it("un error desconocido no se muestra", async () => {
		const html = await render("<b>hola</b>");
		expect(html).not.toContain('role="alert"');
		expect(html).not.toContain("hola");
	});
});
