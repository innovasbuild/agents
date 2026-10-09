import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/app/[tenant]/settings/actions", () => ({
	updateSignupMode: async () => ({ ok: true }),
}));

const { IngresoForm } = await import("@/app/[tenant]/settings/ingreso-form");

const render = (props: { open: boolean; domains: string[] }) =>
	renderToStaticMarkup(
		createElement(IngresoForm, {
			tenantId: "11111111-1111-4111-8111-111111111111",
			slug: "acme",
			...props,
		}),
	);

describe("IngresoForm", () => {
	it("sin dominios deshabilita la opción abierta y explica por qué", () => {
		const html = render({ open: false, domains: [] });

		expect(html).toContain("Solo por invitación");
		expect(html).toContain("Todos los del dominio");
		expect(html).toContain("disabled");
		expect(html).toContain("hola@innov.as");
	});

	it("con dominios muestra cuáles son, en solo lectura", () => {
		const html = render({ open: false, domains: ["acme.com", "acme.com.ar"] });

		expect(html).toContain("@acme.com o @acme.com.ar");
		expect(html).not.toContain("<textarea");
	});

	it("abierto avisa que sacar a alguien de Usuarios no lo bloquea", () => {
		const html = render({ open: true, domains: ["acme.com"] });

		expect(html).toContain("no le impide volver a entrar");
	});

	it("cerrado no muestra ese aviso", () => {
		expect(render({ open: false, domains: ["acme.com"] })).not.toContain(
			"no le impide volver a entrar",
		);
	});
});
