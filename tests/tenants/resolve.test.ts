import { describe, expect, it } from "vitest";
import { brandFromRow, type TenantRow } from "@/lib/tenants/resolve";

describe("brandFromRow", () => {
	it("lee los colores del jsonb", () => {
		const row = {
			brand: {
				primary: "#1D4ED8",
				secondary: "#0F172A",
				logo_url: "innovas/logo.png",
			},
		} as unknown as TenantRow;

		expect(brandFromRow(row)).toEqual({
			primary: "#1D4ED8",
			secondary: "#0F172A",
			logoUrl: "innovas/logo.png",
		});
	});

	it("tolera una marca vacía", () => {
		expect(brandFromRow({ brand: {} } as unknown as TenantRow)).toEqual({});
	});

	it("ignora valores que no son string", () => {
		const row = {
			brand: { primary: 42, secondary: null },
		} as unknown as TenantRow;
		expect(brandFromRow(row)).toEqual({});
	});
});
