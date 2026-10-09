import { describe, expect, it } from "vitest";
import {
	AUTH_METHOD_LABELS,
	AUTH_METHODS,
	isAuthMethod,
} from "@/lib/tenants/auth-methods";

describe("auth methods", () => {
	it("ofrece correo, Google y Microsoft, en ese orden", () => {
		expect(AUTH_METHODS).toEqual(["email", "google", "microsoft"]);
	});

	it("cada método tiene rótulo en castellano", () => {
		expect(AUTH_METHOD_LABELS.email).toBe("Link por correo");
		expect(AUTH_METHOD_LABELS.google).toBe("Google");
		expect(AUTH_METHOD_LABELS.microsoft).toBe("Microsoft");
	});

	it("isAuthMethod rechaza un valor desconocido", () => {
		expect(isAuthMethod("saml")).toBe(false);
		expect(isAuthMethod("microsoft")).toBe(true);
	});
});
