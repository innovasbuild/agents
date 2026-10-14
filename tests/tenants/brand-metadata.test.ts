import { describe, expect, it } from "vitest";
import { tenantMetadata } from "@/lib/tenants/brand-metadata";

describe("tenantMetadata", () => {
	it("pone la empresa en el title y su logo de favicon", () => {
		expect(
			tenantMetadata({
				displayName: "Lagomarsino",
				logoUrl: "https://x.supabase.co/storage/v1/object/public/brand/l.png",
			}),
		).toEqual({
			title: "Lagomarsino - Central IA",
			icons: {
				icon: "https://x.supabase.co/storage/v1/object/public/brand/l.png",
			},
		});
	});

	it("sin logo no toca icons y queda el favicon por defecto", () => {
		const metadata = tenantMetadata({
			displayName: "Lagomarsino",
			logoUrl: null,
		});
		expect(metadata.title).toBe("Lagomarsino - Central IA");
		expect(metadata).not.toHaveProperty("icons");
	});
});
