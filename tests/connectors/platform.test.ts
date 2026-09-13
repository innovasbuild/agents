import { describe, expect, it } from "vitest";
import * as platform from "@/lib/connectors/platform";

describe("constantes de plataforma del spike", () => {
	it("tiene UIDs y URLs no vacíos", () => {
		for (const value of [
			platform.HUBSPOT_MCP_URL,
			platform.HUBSPOT_CONNECTOR_UID,
			platform.GOOGLE_CONNECTOR_UID,
			platform.COLDIQ_BASE_URL,
		]) {
			expect(value.trim()).not.toBe("");
		}
	});

	it("las URLs son https", () => {
		expect(platform.HUBSPOT_MCP_URL).toMatch(/^https:\/\//);
		expect(platform.COLDIQ_BASE_URL).toMatch(/^https:\/\//);
	});

	it("la tool de búsqueda de contactos está entre las de lectura", () => {
		expect(platform.HUBSPOT_READ_TOOLS).toContain(
			platform.HUBSPOT_SEARCH_CONTACTS_TOOL,
		);
	});

	it("HubSpot no expone tools de escritura", () => {
		for (const tool of platform.HUBSPOT_READ_TOOLS) {
			expect(tool).not.toMatch(/^(manage_|submit_)/);
		}
	});
});
