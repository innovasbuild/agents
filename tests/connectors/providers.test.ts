import { describe, expect, it } from "vitest";
import {
	connectionName,
	isProviderKey,
	PROVIDERS,
} from "@/lib/connectors/providers";

describe("registro de proveedores", () => {
	it("nombra la conexión por capacidad cuando admite un solo proveedor sin OAuth", () => {
		expect(connectionName({ provider: "coldiq", id: "binding-1" })).toBe(
			"leads-coldiq",
		);
	});

	it("nombra capacidad-proveedor cuando admite varios", () => {
		expect(connectionName({ provider: "coldiq", id: "binding-1" })).toBe(
			"leads-coldiq",
		);
		expect(connectionName({ provider: "google-places", id: "binding-1" })).toBe(
			"leads-google-places",
		);
	});

	it("proveedores api-key no dependen del id del binding (no son OAuth por usuario)", () => {
		expect(connectionName({ provider: "coldiq", id: "binding-1" })).toBe(
			connectionName({ provider: "coldiq", id: "binding-2" }),
		);
	});

	it("hubspot (OAuth por usuario) incluye el id del binding en el nombre de conexión", () => {
		expect(connectionName({ provider: "hubspot", id: "binding-a" })).toBe(
			"crm-binding-a",
		);
	});

	it("dos bindings de hubspot de tenants distintos nunca comparten nombre de conexión (evita fuga de credenciales cross-tenant, spike S7)", () => {
		const a = connectionName({ provider: "hubspot", id: "tenant-a-binding" });
		const b = connectionName({ provider: "hubspot", id: "tenant-b-binding" });
		expect(a).not.toBe(b);
	});

	it("todo nombre cumple la regla de eve", () => {
		for (const key of Object.keys(PROVIDERS)) {
			if (!isProviderKey(key)) throw new Error(key);
			expect(
				connectionName({
					provider: key,
					id: "7522ac1b-4e10-409e-bbd8-52319cee9a65",
				}),
			).toMatch(/^[a-z][a-z0-9-]{0,63}$/);
		}
	});

	it("reconoce solo proveedores del registro", () => {
		expect(isProviderKey("hubspot")).toBe(true);
		expect(isProviderKey("salesforce")).toBe(false);
		expect(isProviderKey("toString")).toBe(false);
	});

	it("gmail es una tool, no una conexión", () => {
		expect(PROVIDERS.gmail.kind).toBe("tool");
	});

	it("wiki es una tool del brain sin llave", () => {
		expect(PROVIDERS.wiki).toEqual({
			capability: "brain",
			multiple: false,
			kind: "tool",
			authKind: "none",
		});
	});
});
