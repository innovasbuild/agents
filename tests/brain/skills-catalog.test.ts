import { describe, expect, it, vi } from "vitest";
import type { Level } from "@/lib/brain/core/access/types";
import { BrainError } from "@/lib/brain/core/errors";
import {
	describeSkills,
	loadSkillCatalog,
	MAX_READABLE_BYTES,
	type SkillCatalogDeps,
} from "@/lib/brain/core/skills/catalog";
import type {
	SkillOverviewRow,
	SkillSnapshot,
} from "@/lib/brain/core/skills/store";

const bytes = (text: string) => new TextEncoder().encode(text);

function snapshot(over: Partial<SkillSnapshot> = {}): SkillSnapshot {
	return {
		action: "publicar",
		version: 2,
		pageRevision: 5,
		filesDigest: "fd",
		title: "Reporte",
		description: "Arma el reporte mensual.",
		body: "# Pasos\n1. Uno",
		frontmatter: { description: "Arma el reporte mensual." },
		manifest: [
			{ path: "references/guia.md", sha256: "pub-guia", size: 4 },
			{ path: "assets/logo.png", sha256: "pub-logo", size: 3 },
		],
		digest: "dg",
		publishedAt: "2026-10-13T12:00:00Z",
		...over,
	};
}

function row(slug: string, current: SkillSnapshot | null): SkillOverviewRow {
	return {
		pageId: `page-${slug}`,
		slug,
		revision: 9,
		draftFilesDigest: "draft",
		current,
	};
}

function deps(
	rows: SkillOverviewRow[],
	over: Partial<SkillCatalogDeps> = {},
): SkillCatalogDeps {
	const blobs: Record<string, Uint8Array> = {
		"pub-guia": bytes("guía"),
		"pub-logo": new Uint8Array([0x89, 0x00, 0x01]),
	};
	return {
		overview: async () => rows,
		levelOf: (): Level | null => "lector",
		blob: vi.fn(async (sha: string) => blobs[sha] ?? null),
		record: vi.fn(async () => {}),
		...over,
	};
}

async function expectBrainError(promise: Promise<unknown>, code: string) {
	const error = await promise.then(
		() => null,
		(e: unknown) => e,
	);
	expect(error).toBeInstanceOf(BrainError);
	expect((error as BrainError).code).toBe(code);
	return (error as BrainError).message;
}

describe("loadSkillCatalog", () => {
	it("lista las skills con publicación vigente que la persona puede leer, por nombre", async () => {
		const catalog = await loadSkillCatalog(
			deps([
				row("skills/ventas/reporte", snapshot()),
				row("skills/alta", snapshot({ version: 1, description: "Alta." })),
				row("skills/borrador", null),
				row("skills/retirada", snapshot({ action: "retirar" })),
			]),
		);
		expect(catalog?.list()).toEqual([
			{
				name: "alta",
				description: "Alta.",
				version: 1,
				publishedAt: "2026-10-13T12:00:00Z",
			},
			{
				name: "reporte",
				description: "Arma el reporte mensual.",
				version: 2,
				publishedAt: "2026-10-13T12:00:00Z",
			},
		]);
	});

	it("devuelve null si la persona no ve ninguna", async () => {
		expect(await loadSkillCatalog(deps([row("skills/x", null)]))).toBeNull();
		expect(
			await loadSkillCatalog(
				deps([row("skills/x", snapshot())], { levelOf: () => null }),
			),
		).toBeNull();
	});

	it("carga la copia publicada también para un editor, y registra la carga", async () => {
		const d = deps([row("skills/ventas/reporte", snapshot())], {
			levelOf: () => "editor",
		});
		const catalog = await loadSkillCatalog(d);
		expect(await catalog?.load("reporte")).toEqual({
			name: "reporte",
			description: "Arma el reporte mensual.",
			version: 2,
			publishedAt: "2026-10-13T12:00:00Z",
			digest: "dg",
			instructions: "# Pasos\n1. Uno",
			files: [
				{ path: "references/guia.md", size: 4, readable: true },
				{ path: "assets/logo.png", size: 3, readable: true },
			],
		});
		expect(d.record).toHaveBeenCalledWith({
			slug: "skills/ventas/reporte",
			name: "reporte",
			version: 2,
			digest: "dg",
		});
	});

	it("incluye compatibility si la versión lo trae y marca no legible lo que pasa el tope", async () => {
		const catalog = await loadSkillCatalog(
			deps([
				row(
					"skills/a",
					snapshot({
						frontmatter: { compatibility: "Requiere Python 3" },
						manifest: [
							{ path: "big.csv", sha256: "x", size: MAX_READABLE_BYTES + 1 },
						],
					}),
				),
			]),
		);
		const loaded = await catalog?.load("a");
		expect(loaded?.compatibility).toBe("Requiere Python 3");
		expect(loaded?.files).toEqual([
			{ path: "big.csv", size: MAX_READABLE_BYTES + 1, readable: false },
		]);
	});

	it("una skill ajena responde igual que una que no existe", async () => {
		const catalog = await loadSkillCatalog(
			deps(
				[
					row("skills/rrhh/sueldos", snapshot()),
					row("skills/ventas/reporte", snapshot()),
				],
				{
					levelOf: (slug) => (slug.startsWith("skills/rrhh") ? null : "lector"),
				},
			),
		);
		expect(catalog?.list().map((s) => s.name)).toEqual(["reporte"]);
		const ajena = await expectBrainError(
			catalog?.load("sueldos") as Promise<unknown>,
			"not_found",
		);
		const inventada = await expectBrainError(
			catalog?.load("inventada") as Promise<unknown>,
			"not_found",
		);
		expect(ajena.replace("sueldos", "X")).toBe(
			inventada.replace("inventada", "X"),
		);
		await expectBrainError(
			catalog?.file("sueldos", "references/guia.md") as Promise<unknown>,
			"not_found",
		);
	});

	it("una falla del registro no rompe la carga", async () => {
		const spy = vi.spyOn(console, "error").mockImplementation(() => {});
		const catalog = await loadSkillCatalog(
			deps([row("skills/a", snapshot())], {
				record: async () => {
					throw new Error("sin base");
				},
			}),
		);
		expect((await catalog?.load("a"))?.version).toBe(2);
		spy.mockRestore();
	});
});

describe("catalog.file", () => {
	it("lee por el sha256 del manifiesto publicado", async () => {
		const d = deps([row("skills/a", snapshot())]);
		const catalog = await loadSkillCatalog(d);
		expect(await catalog?.file("a", "references/guia.md")).toEqual({
			name: "a",
			version: 2,
			path: "references/guia.md",
			size: 4,
			content: "guía",
		});
		expect(d.blob).toHaveBeenCalledWith("pub-guia");
		expect(d.record).not.toHaveBeenCalled();
	});

	it("rechaza una ruta fuera del manifiesto sin leer nada", async () => {
		const d = deps([row("skills/a", snapshot())]);
		const catalog = await loadSkillCatalog(d);
		await expectBrainError(
			catalog?.file("a", "scripts/otro.py") as Promise<unknown>,
			"not_found",
		);
		expect(d.blob).not.toHaveBeenCalled();
	});

	it("rechaza un binario y un archivo que pasa el tope, nombrando la descarga", async () => {
		const d = deps([
			row(
				"skills/a",
				snapshot({
					manifest: [
						{ path: "assets/logo.png", sha256: "pub-logo", size: 3 },
						{ path: "big.csv", sha256: "x", size: MAX_READABLE_BYTES + 1 },
					],
				}),
			),
		]);
		const catalog = await loadSkillCatalog(d);
		const binario = await expectBrainError(
			catalog?.file("a", "assets/logo.png") as Promise<unknown>,
			"validation",
		);
		expect(binario).toContain("descarga del paquete");
		await expectBrainError(
			catalog?.file("a", "big.csv") as Promise<unknown>,
			"validation",
		);
		// El grande se rechaza por el tamaño del manifiesto, sin bajarlo.
		expect(d.blob).toHaveBeenCalledTimes(1);
	});

	it("un blob ausente es un error interno, no un not_found", async () => {
		const catalog = await loadSkillCatalog(
			deps([
				row(
					"skills/a",
					snapshot({
						manifest: [{ path: "a.md", sha256: "perdido", size: 1 }],
					}),
				),
			]),
		);
		const error = await catalog?.file("a", "a.md").then(
			() => null,
			(e: unknown) => e,
		);
		expect(error).toBeInstanceOf(Error);
		expect(error).not.toBeInstanceOf(BrainError);
	});
});

describe("describeSkills", () => {
	const summary = (name: string, description = "Hace algo.") => ({
		name,
		description,
		version: 1,
		publishedAt: "2026-10-13T12:00:00Z",
	});

	it("una línea por skill", () => {
		expect(describeSkills([summary("a"), summary("b", "Otra.")])).toBe(
			"- a: Hace algo.\n- b: Otra.",
		);
	});

	it("normaliza saltos de línea y corta a 300 caracteres", () => {
		const text = describeSkills([
			summary("a", `uno\n\n  dos\r\ntres ${"x".repeat(400)}`),
		]);
		expect(text.split("\n")).toHaveLength(1);
		expect(text.startsWith("- a: uno dos tres x")).toBe(true);
		// "- a: " + 300 caracteres, el último es la elipsis.
		expect(text).toHaveLength(5 + 300);
		expect(text.endsWith("…")).toBe(true);
	});

	it("con más de 30 lista 30 y dice cuántas faltan", () => {
		const many = Array.from({ length: 33 }, (_, i) =>
			summary(`s${String(i).padStart(2, "0")}`),
		);
		const lines = describeSkills(many).split("\n");
		expect(lines).toHaveLength(31);
		expect(lines[30]).toBe("Hay 3 más: se ven con skill_list.");
	});
});
