import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { LoginMethodsField } from "@/components/auth/login-methods-field";

const html = (currentMethod: "google" | null) =>
	renderToStaticMarkup(
		createElement(LoginMethodsField, {
			methods: ["google"],
			currentMethod,
			onToggle: () => undefined,
		}),
	);

describe("LoginMethodsField", () => {
	it("deshabilita solo el método de la sesión y lo explica", () => {
		const out = html("google");
		expect(out.match(/disabled=""/g)).toHaveLength(1);
		expect(out).toContain("Es la que estás usando ahora.");
		expect(out).toContain("Correo con código");
	});
	it("sin método actual no deshabilita nada", () => {
		expect(html(null)).not.toContain("disabled");
	});
});
