import { describe, expect, it } from "vitest";
import {
	connectionName,
	isProviderKey,
	PROVIDERS,
} from "@/lib/connectors/providers";

describe("registro de proveedores", () => {
	it("nombra la conexión por capacidad cuando admite un solo proveedor", () => {
		expect(connectionName("hubspot")).toBe("crm");
		expect(connectionName("innovas-brains")).toBe("brain");
	});

	it("nombra capacidad-proveedor cuando admite varios", () => {
		expect(connectionName("coldiq")).toBe("leads-coldiq");
		expect(connectionName("google-places")).toBe("leads-google-places");
	});

	it("todo nombre cumple la regla de eve", () => {
		for (const key of Object.keys(PROVIDERS)) {
			if (!isProviderKey(key)) throw new Error(key);
			expect(connectionName(key)).toMatch(/^[a-z][a-z0-9-]{0,63}$/);
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
});
