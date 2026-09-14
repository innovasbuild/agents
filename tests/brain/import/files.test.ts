import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { readVaultFiles } from "@/lib/brain/import/files";

const root = fileURLToPath(
	new URL("../../fixtures/brain-vault", import.meta.url),
);

describe("readVaultFiles", () => {
	it("lista rutas relativas ordenadas, sin carpetas ocultas, y lee solo markdown", async () => {
		const files = await readVaultFiles(root);
		expect(files.map((file) => file.path)).toEqual([
			"company/innov-overview.md",
			"marketing/LinkedIn institucional — INNOV.AS.md",
			"producto/linea-proyectos.md",
			"propuesta.pdf",
		]);
		expect(files.find((file) => file.path === "propuesta.pdf")?.raw).toBe("");
		expect(files[0].raw).toContain("title: Overview de la empresa");
	});
});
