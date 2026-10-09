import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/browser", () => ({
	createBrowserSupabase: () => ({}),
}));

vi.mock("@/app/(auth)/login/actions", () => ({
	canSignUpByDomain: async () => false,
}));

const { LoginForm } = await import("@/app/(auth)/login/login-form");

const render = (methods: ("email" | "google" | "microsoft")[]) =>
	renderToStaticMarkup(createElement(LoginForm, { methods, next: null }));

describe("LoginForm", () => {
	it("con solo email no dibuja Google ni el separador", () => {
		const html = render(["email"]);

		expect(html).toContain("Mandarme un link");
		expect(html).not.toContain("Entrar con Google");
		expect(html).not.toContain("bg-border");
	});

	it("con solo Google no dibuja el formulario de email ni el separador", () => {
		const html = render(["google"]);

		expect(html).toContain("Entrar con Google");
		expect(html).not.toContain("Mandarme un link");
		expect(html).not.toContain("bg-border");
	});

	it("con los dos muestra Google, el separador y el email", () => {
		const html = render(["email", "google"]);

		expect(html).toContain("Entrar con Google");
		expect(html).toContain("bg-border");
		expect(html).toContain("Mandarme un link");
	});

	it("con solo Microsoft no dibuja Google, el formulario ni el separador", () => {
		const html = render(["microsoft"]);

		expect(html).toContain("Entrar con Microsoft");
		expect(html).not.toContain("Entrar con Google");
		expect(html).not.toContain("Mandarme un link");
		expect(html).not.toContain("bg-border");
	});

	it("con los tres, Microsoft va antes que Google y el separador antes del correo", () => {
		const html = render(["email", "google", "microsoft"]);

		expect(html.indexOf("Entrar con Microsoft")).toBeGreaterThan(-1);
		expect(html.indexOf("Entrar con Microsoft")).toBeLessThan(
			html.indexOf("Entrar con Google"),
		);
		expect(html.indexOf("Entrar con Google")).toBeLessThan(
			html.indexOf("bg-border"),
		);
		expect(html.indexOf("bg-border")).toBeLessThan(
			html.indexOf("Mandarme un link"),
		);
	});

	it("sin Microsoft en los métodos, el botón no aparece", () => {
		expect(render(["email", "google"])).not.toContain("Entrar con Microsoft");
	});
});
