import { describe, expect, it } from "vitest";
import { attributionError } from "@/lib/outreach/services/executor";
import { defaultTenant } from "../fake-store";

describe("attributionError", () => {
	it("null si hook, vector e idioma están en las listas del tenant; mensaje citable si alguno no", () => {
		const tenant = defaultTenant();
		expect(
			attributionError(tenant, { hook: "h1", vector: "v1", idioma: "es_ar" }),
		).toBeNull();
		expect(
			attributionError(tenant, { hook: "h_x", vector: "v1", idioma: "es_ar" }),
		).toBe(
			"hook, vector o idioma fuera de las listas del cliente (h_x, v1, es_ar)",
		);
		expect(
			attributionError(tenant, { hook: "h1", vector: "v9", idioma: "es_ar" }),
		).not.toBeNull();
		expect(
			attributionError(tenant, { hook: "h1", vector: "v1", idioma: "pt_br" }),
		).not.toBeNull();
	});
});
