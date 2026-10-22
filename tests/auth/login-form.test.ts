import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/browser", () => ({
	createBrowserSupabase: () => ({}),
}));

vi.mock("@/app/(auth)/login/actions", () => ({
	canSignUpByDomain: async () => false,
	completeLogin: async () => ({ ok: false, message: "" }),
}));

const { LoginForm, RESEND_COOLDOWN_SECONDS, ResendCodeButton } = await import(
	"@/app/(auth)/login/login-form"
);

const render = (methods: ("email" | "google" | "microsoft")[]) =>
	renderToStaticMarkup(createElement(LoginForm, { methods, next: null }));

describe("LoginForm", () => {
	it("con solo email no dibuja Google ni el separador", () => {
		const html = render(["email"]);

		expect(html).toContain("Mandarme un código");
		expect(html).not.toContain("Entrar con Google");
		expect(html).not.toContain("bg-border");
	});

	it("con solo Google no dibuja el formulario de email ni el separador", () => {
		const html = render(["google"]);

		expect(html).toContain("Entrar con Google");
		expect(html).not.toContain("Mandarme un código");
		expect(html).not.toContain("bg-border");
	});

	it("con los dos muestra Google, el separador y el email", () => {
		const html = render(["email", "google"]);

		expect(html).toContain("Entrar con Google");
		expect(html).toContain("bg-border");
		expect(html).toContain("Mandarme un código");
	});

	it("con solo Microsoft no dibuja Google, el formulario ni el separador", () => {
		const html = render(["microsoft"]);

		expect(html).toContain("Entrar con Microsoft");
		expect(html).not.toContain("Entrar con Google");
		expect(html).not.toContain("Mandarme un código");
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
			html.indexOf("Mandarme un código"),
		);
	});

	it("sin Microsoft en los métodos, el botón no aparece", () => {
		expect(render(["email", "google"])).not.toContain("Entrar con Microsoft");
	});
});

describe("ResendCodeButton", () => {
	const button = (props: { sending: boolean; secondsLeft: number }) =>
		renderToStaticMarkup(
			createElement(ResendCodeButton, { ...props, onClick: () => {} }),
		);

	it("mientras sale el pedido está deshabilitado", () => {
		const html = button({ sending: true, secondsLeft: 0 });
		expect(html).toContain('disabled=""');
	});

	it("después de mandar, espera y muestra cuánto falta", () => {
		const html = button({ sending: false, secondsLeft: 42 });
		expect(html).toContain('disabled=""');
		expect(html).toContain("42 s");
	});

	it("pasada la espera se puede volver a pedir", () => {
		const html = button({ sending: false, secondsLeft: 0 });
		expect(html).not.toContain('disabled=""');
		expect(html).toContain("Mandar otro");
	});

	it("la espera es de un minuto", () => {
		expect(RESEND_COOLDOWN_SECONDS).toBe(60);
	});
});

describe("LoginForm mode signup", () => {
	const renderSignup = () =>
		renderToStaticMarkup(
			createElement(LoginForm, {
				methods: ["microsoft", "google", "email"],
				next: "/empezar",
				mode: "signup",
			}),
		);

	it("usa los copys del paso 1", () => {
		const html = renderSignup();
		expect(html).toContain("Creá tu cuenta");
		expect(html).toContain("Continuar con Microsoft");
		expect(html).toContain("Continuar con Google");
		expect(html).toContain("Correo de trabajo");
		expect(html).toContain("vos@tuempresa.com");
		expect(html).toContain("Mandarme un código");
		expect(html).toContain("Al crear la cuenta aceptás");
	});

	it("el modo login no cambia", () => {
		const html = renderToStaticMarkup(
			createElement(LoginForm, { methods: ["email"], next: null }),
		);
		expect(html).not.toContain("Creá tu cuenta");
		expect(html).toContain("tu@empresa.com");
	});
});
