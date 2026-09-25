import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { WikiConfig } from "@/lib/brain/config";
import type { VaultFile } from "@/lib/brain/import/document";
import { readVaultFiles } from "@/lib/brain/import/files";
import { parseManifest } from "@/lib/brain/import/manifest";
import { buildImportPlan, formatImportReport } from "@/lib/brain/import/plan";

const config: WikiConfig = {
	categories: ["company", "producto", "marketing", "proyectos"],
	requiredFrontmatter: ["title", "category", "status", "updated"],
	search: "fts",
	mcpLimits: { readsPerMinute: 60, writesPerMinute: 10 },
};

const manifest = parseManifest({
	include: [
		"company/**/*.md",
		"producto/**/*.md",
		"marketing/**/*.md",
		"proyectos/**/*.md",
	],
	exclude: [],
	tags: [{ match: "producto/linea-proyectos.md", tags: ["canon:icp"] }],
});

const root = fileURLToPath(
	new URL("../../fixtures/brain-vault", import.meta.url),
);

function hash(raw: string): string {
	return createHash("sha256").update(raw).digest("hex");
}

function plan(
	files: VaultFile[],
	existing = [] as Parameters<typeof buildImportPlan>[0]["existing"],
	force: string[] = [],
) {
	return buildImportPlan({
		files,
		manifest,
		config,
		existing,
		force,
		today: "2026-09-13",
	});
}

describe("buildImportPlan", () => {
	it("con la bóveda de fixture crea tres páginas, excluye el resto y reescribe links", async () => {
		const result = plan(await readVaultFiles(root));

		expect(result.blocking).toBe(false);
		expect(result.excluded).toEqual(["propuesta.pdf"]);
		expect(result.entries.map((entry) => [entry.action, entry.slug])).toEqual([
			["crear", "company/innov-overview"],
			["crear", "marketing/linkedin-institucional-innov-as"],
			["crear", "producto/linea-proyectos"],
		]);
		const overview = result.entries[0].draft;
		expect(overview?.body).toContain(
			"[[producto/linea-proyectos|linea-proyectos]]",
		);
		expect(result.entries[2].tags).toEqual(["canon:icp"]);
		expect(result.unresolvedLinks).toEqual([
			{ sourcePath: "company/innov-overview.md", target: "AGENT" },
		]);
	});

	it("no toca lo que no cambió en la bóveda", () => {
		const raw = "# ICP\n\nTexto";
		const result = plan(
			[{ path: "producto/icp.md", raw }],
			[
				{
					slug: "producto/icp",
					revision: 1,
					sourceHash: hash(raw),
					sourceRevision: 1,
				},
			],
		);
		expect(result.entries[0]).toMatchObject({
			action: "sin cambios",
			draft: null,
		});
	});

	it("actualiza si cambió en la bóveda y nadie la editó en la plataforma", () => {
		const result = plan(
			[{ path: "producto/icp.md", raw: "# ICP\n\nNuevo" }],
			[
				{
					slug: "producto/icp",
					revision: 2,
					sourceHash: "viejo",
					sourceRevision: 2,
				},
			],
		);
		expect(result.entries[0]).toMatchObject({
			action: "actualizar",
			baseRevision: 2,
		});
	});

	it("saltea una página editada en la plataforma, salvo --force", () => {
		const files = [{ path: "producto/icp.md", raw: "# ICP\n\nNuevo" }];
		const existing = [
			{
				slug: "producto/icp",
				revision: 3,
				sourceHash: "viejo",
				sourceRevision: 1,
			},
		];
		expect(plan(files, existing).entries[0]).toMatchObject({
			action: "salteada",
		});
		expect(plan(files, existing, ["producto/icp"]).entries[0]).toMatchObject({
			action: "actualizar",
			baseRevision: 3,
		});
	});

	it("una página nacida en la plataforma no se pisa", () => {
		const result = plan(
			[{ path: "producto/icp.md", raw: "# ICP" }],
			[
				{
					slug: "producto/icp",
					revision: 1,
					sourceHash: null,
					sourceRevision: null,
				},
			],
		);
		expect(result.entries[0].action).toBe("salteada");
	});

	it("dos archivos con el mismo slug son error bloqueante", () => {
		const result = plan([
			{ path: "producto/Línea.md", raw: "# A" },
			{ path: "producto/linea.md", raw: "# B" },
		]);
		expect(result.blocking).toBe(true);
		expect(result.entries.every((entry) => entry.action === "error")).toBe(
			true,
		);
	});

	it("una categoría fuera del binding es error bloqueante", () => {
		const strict: WikiConfig = { ...config, categories: ["company"] };
		const result = buildImportPlan({
			files: [{ path: "producto/icp.md", raw: "# ICP" }],
			manifest,
			config: strict,
			existing: [],
			force: [],
			today: "2026-09-13",
		});
		expect(result.blocking).toBe(true);
		expect(result.entries[0].detail).toContain("category");
	});

	it("el reporte avisa los errores bloqueantes", () => {
		const report = formatImportReport(
			plan([
				{ path: "proyectos/x.md", raw: "---\ncategory: marketing\n---\nx" },
			]),
		);
		expect(report).toContain("error");
		expect(report).toContain("bloqueantes");
	});
});
