import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/browser", () => ({
	createBrowserSupabase: () => ({}),
}));

const { LoginForm } = await import("@/app/(auth)/login/login-form");

const render = (methods: ("email" | "google")[]) =>
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
});
