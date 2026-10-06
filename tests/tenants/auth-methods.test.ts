import { describe, expect, it } from "vitest";
import {
	AUTH_METHOD_LABELS,
	AUTH_METHODS,
	isAuthMethod,
} from "@/lib/tenants/auth-methods";

describe("auth methods", () => {
	it("la etapa 1 ofrece email y google, en ese orden", () => {
		expect(AUTH_METHODS).toEqual(["email", "google"]);
	});

	it("cada método tiene rótulo en castellano", () => {
		expect(AUTH_METHOD_LABELS.email).toBe("Link por correo");
		expect(AUTH_METHOD_LABELS.google).toBe("Google");
	});

	it("isAuthMethod rechaza un valor desconocido", () => {
		expect(isAuthMethod("microsoft")).toBe(false);
		expect(isAuthMethod("google")).toBe(true);
	});
});
