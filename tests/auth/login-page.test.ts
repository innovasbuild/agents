import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state: { methods: string[]; received: string[] } = {
	methods: ["email"],
	received: [],
};

vi.mock("@/lib/tenants/public", () => ({
	loadOfferedMethods: async () => state.methods,
}));
vi.mock("@/app/(auth)/login/login-form", () => ({
	LoginForm: ({ methods }: { methods: string[] }) => {
		state.received = methods;
		return null;
	},
}));

const { default: LoginPage } = await import("@/app/(auth)/login/page");

const render = async (query: Record<string, string> = {}) =>
	renderToStaticMarkup(
		await LoginPage({ searchParams: Promise.resolve(query) }),
	);

describe("/login", () => {
	beforeEach(() => {
		state.methods = ["email", "google"];
		state.received = [];
	});

	it("le pasa al formulario los métodos que alguna empresa ofrece", async () => {
		await render();
		expect(state.received).toEqual(["email", "google"]);
	});

	it("con error=auth_failed avisa", async () => {
		const html = await render({ error: "auth_failed" });
		expect(html).toContain("No pudimos abrir tu sesión. Probá de nuevo.");
		expect(html).toContain('role="alert"');
	});

	it("sin error no muestra aviso", async () => {
		expect(await render()).not.toContain('role="alert"');
	});
});
