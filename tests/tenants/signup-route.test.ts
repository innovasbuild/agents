import { describe, expect, it } from "vitest";
import { signupRoute, signupRoutePath } from "@/lib/tenants/signup-route";

const client = (result: { data: unknown; error: unknown }) => ({
	rpc: () => Promise.resolve(result),
});

describe("signupRoute", () => {
	it.each(["chat", "empezar", "dominio_tomado", "sin_acceso"])(
		"mapea %s",
		async (value) => {
			expect(await signupRoute(client({ data: value, error: null }))).toBe(
				value,
			);
		},
	);

	it("error → sin_acceso", async () => {
		expect(
			await signupRoute(client({ data: null, error: { message: "x" } })),
		).toBe("sin_acceso");
	});

	it("un valor desconocido → sin_acceso", async () => {
		expect(await signupRoute(client({ data: "otra", error: null }))).toBe(
			"sin_acceso",
		);
	});
});

describe("signupRoutePath", () => {
	it("arma los paths", () => {
		expect(signupRoutePath("chat", "acme")).toBe("/acme");
		expect(signupRoutePath("empezar", null)).toBe("/empezar/empresa");
		expect(signupRoutePath("dominio_tomado", null)).toBe(
			"/empezar/dominio-tomado",
		);
		expect(signupRoutePath("sin_acceso", null)).toBe("/sin-acceso");
	});

	it("chat sin slug → sin-acceso", () => {
		expect(signupRoutePath("chat", null)).toBe("/sin-acceso");
	});
});
