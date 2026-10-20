import { describe, expect, it } from "vitest";
import {
	BrainConflict,
	BrainForbidden,
	BrainValidation,
} from "@/lib/brain/core/errors";
import {
	commitSkillUpload,
	previewSkillUpload,
	type UploadTarget,
} from "@/lib/brain/core/skills/upload";
import { MAX_SLUG_LENGTH } from "@/lib/brain/core/types";
import {
	bytes,
	members,
	setup,
	setupCurrent,
	skillRow,
} from "./skills-fixtures";

const VENTAS = "skills/ventas/facturacion";
const ADMIN = [members("skills/ventas", "administrador")];
const FOLDER: UploadTarget = { kind: "folder", folder: "ventas" };

function skillMd(name: string | null): string {
	const nameLine = name === null ? "" : `name: ${JSON.stringify(name)}\n`;
	return `---\n${nameLine}description: Usar para emitir facturas.\ncompatibility: Python 3\n---\n\n# Facturación\n\nPasos.\n`;
}

function pkg(name: string | null = "facturacion") {
	return [
		{ path: "SKILL.md", bytes: bytes(skillMd(name)) },
		{ path: "scripts/calc.py", bytes: bytes("print(1)") },
		{ path: "references/guia.md", bytes: bytes("# Guía") },
	];
}

// La persona administra skills/ventas, salvo que se diga otra cosa.
function deps(
	opts: Parameters<typeof setup>[0] = {},
): ReturnType<typeof setup> {
	return setup({ rules: ADMIN, rows: [], ...opts });
}

const existing = (slug = VENTAS) => [skillRow(slug, "p1", null)];

describe("previewSkillUpload", () => {
	it("a una carpeta sin la skill: crea con el name del SKILL.md", async () => {
		const { deps: d, save, putFile } = deps();
		const result = await previewSkillUpload("acme", FOLDER, pkg(), d);
		expect(result).toEqual({
			ok: true,
			mode: "crear",
			slug: VENTAS,
			name: "facturacion",
			description: "Usar para emitir facturas.",
			files: [
				{ path: "scripts/calc.py", size: 8 },
				{ path: "references/guia.md", size: 7 },
			],
			totalBytes: 15,
			warnings: [],
		});
		expect(save).not.toHaveBeenCalled();
		expect(putFile).not.toHaveBeenCalled();
	});

	it("directo bajo skills/ con la carpeta vacía", async () => {
		const { deps: d } = deps({ rules: [members("skills", "administrador")] });
		const result = await previewSkillUpload(
			"acme",
			{ kind: "folder", folder: "" },
			pkg(),
			d,
		);
		expect(result).toMatchObject({
			ok: true,
			mode: "crear",
			slug: "skills/facturacion",
		});
	});

	it("con la skill ya existente en esa ruta: reemplaza", async () => {
		const { deps: d } = deps({ rows: existing() });
		const result = await previewSkillUpload("acme", FOLDER, pkg(), d);
		expect(result).toMatchObject({
			ok: true,
			mode: "reemplazar",
			slug: VENTAS,
		});
	});

	it("crear exige administrador de la carpeta", async () => {
		for (const rules of [
			[members("skills/ventas", "editor")],
			[],
			[members("", "editor")],
		]) {
			const { deps: d } = deps({ rules });
			expect(await previewSkillUpload("acme", FOLDER, pkg(), d)).toEqual({
				ok: false,
				code: "not_found",
				message: "No encontrado.",
			});
		}
	});

	it("un administrador de la empresa crea en cualquier carpeta", async () => {
		const { deps: d } = deps({ role: "tenant_admin", rules: [] });
		expect(await previewSkillUpload("acme", FOLDER, pkg(), d)).toMatchObject({
			ok: true,
			mode: "crear",
		});
	});

	it("reemplazar exige ser editor de la skill", async () => {
		const lector = deps({
			rows: existing(),
			rules: [members("skills/ventas", "lector")],
		});
		expect(
			await previewSkillUpload("acme", FOLDER, pkg(), lector.deps),
		).toMatchObject({ ok: false, code: "not_found" });
		const editor = deps({
			rows: existing(),
			rules: [members("skills/ventas", "editor")],
		});
		expect(
			await previewSkillUpload("acme", FOLDER, pkg(), editor.deps),
		).toMatchObject({ ok: true, mode: "reemplazar" });
	});

	it("desde el panel de una skill, un name distinto avisa y no renombra", async () => {
		const { deps: d } = deps({ rows: existing() });
		const result = await previewSkillUpload(
			"acme",
			{ kind: "skill", slug: VENTAS },
			pkg("cobranzas"),
			d,
		);
		if (!result.ok) throw new Error(result.message);
		expect(result.mode).toBe("reemplazar");
		expect(result.slug).toBe(VENTAS);
		expect(result.warnings).toHaveLength(1);
		expect(result.warnings[0]).toContain("cobranzas");
		expect(result.warnings[0]).toContain("facturacion");
		expect(result.warnings[0]).toMatch(/no se renombra/);
	});

	it("desde el panel de una skill, con el mismo name no avisa", async () => {
		const { deps: d } = deps({ rows: existing() });
		const result = await previewSkillUpload(
			"acme",
			{ kind: "skill", slug: VENTAS },
			pkg(),
			d,
		);
		expect(result).toMatchObject({ ok: true, warnings: [] });
	});

	it("una skill de destino que no existe o no se ve: not_found", async () => {
		const { deps: d } = deps();
		expect(
			await previewSkillUpload(
				"acme",
				{ kind: "skill", slug: VENTAS },
				pkg(),
				d,
			),
		).toMatchObject({ ok: false, code: "not_found" });
		const hidden = deps({
			rows: existing(),
			rules: [members("skills/ventas", "ninguno")],
		});
		expect(
			await previewSkillUpload(
				"acme",
				{ kind: "skill", slug: VENTAS },
				pkg(),
				hidden.deps,
			),
		).toMatchObject({ ok: false, code: "not_found" });
	});

	it("un name ausente o inválido es un problema y no escribe nada", async () => {
		for (const name of [null, "Ventas", "a/b", "../x", "a".repeat(65)]) {
			for (const target of [
				FOLDER,
				{ kind: "skill", slug: VENTAS } as UploadTarget,
			]) {
				const { deps: d, save, putFile } = deps({ rows: existing() });
				for (const run of [previewSkillUpload, commitSkillUpload]) {
					const result = await run("acme", target, pkg(name), d);
					if (result.ok) throw new Error(`tenía que fallar: ${name}`);
					expect(result.code).toBe("validation");
					expect(result.problems?.length).toBeGreaterThan(0);
					expect(result.problems?.join(" ")).toMatch(/name/);
				}
				expect(save).not.toHaveBeenCalled();
				expect(putFile).not.toHaveBeenCalled();
			}
		}
	});

	describe("una skill del mismo nombre en otra carpeta avisa solo si la persona la ve", () => {
		const otra = "skills/rrhh/facturacion";
		const warningsOf = async (d: ReturnType<typeof setup>["deps"]) => {
			const result = await previewSkillUpload("acme", FOLDER, pkg(), d);
			if (!result.ok) throw new Error(result.message);
			return result.warnings;
		};

		it("editor de esa carpeta: ve el borrador y se nombra", async () => {
			const { deps: d } = deps({
				rows: [skillRow(otra, "p9", null)],
				rules: [...ADMIN, members("skills/rrhh", "editor")],
			});
			const warnings = await warningsOf(d);
			expect(warnings).toHaveLength(1);
			expect(warnings[0]).toContain(otra);
		});

		it("lector y la otra sin publicar: no se nombra", async () => {
			const { deps: d } = deps({ rows: [skillRow(otra, "p9", null)] });
			expect(await warningsOf(d)).toEqual([]);
		});

		it("lector y la otra publicada: se nombra", async () => {
			const { deps: d } = deps({ rows: [skillRow(otra, "p9")] });
			const warnings = await warningsOf(d);
			expect(warnings).toHaveLength(1);
			expect(warnings[0]).toContain(otra);
		});

		it("lector y la otra retirada: no se nombra", async () => {
			const { deps: d } = deps({
				rows: [skillRow(otra, "p9", { ...setupCurrent(), action: "retirar" })],
			});
			expect(await warningsOf(d)).toEqual([]);
		});

		it("sin acceso a esa carpeta (ninguno): no se nombra aunque esté publicada", async () => {
			const { deps: d } = deps({
				rows: [skillRow(otra, "p9")],
				rules: [...ADMIN, members("skills/rrhh", "ninguno")],
			});
			expect(await warningsOf(d)).toEqual([]);
		});
	});

	it("una carpeta inválida o una ruta demasiado larga: validación", async () => {
		for (const folder of ["Ventas", "a//b", "../x"]) {
			const { deps: d } = deps();
			expect(
				await previewSkillUpload("acme", { kind: "folder", folder }, pkg(), d),
			).toMatchObject({ ok: false, code: "validation" });
		}
		const long = ["a", "b", "c"].map((c) => c.repeat(64)).join("/");
		expect(`skills/${long}/facturacion`.length).toBeGreaterThan(
			MAX_SLUG_LENGTH,
		);
		const { deps: d } = deps({ role: "tenant_admin" });
		expect(
			await previewSkillUpload(
				"acme",
				{ kind: "folder", folder: long },
				pkg(),
				d,
			),
		).toMatchObject({ ok: false, code: "validation" });
	});

	it("un brain que no es wiki: unsupported", async () => {
		const { deps: d } = deps();
		expect(
			await previewSkillUpload("acme", FOLDER, pkg(), {
				...d,
				binding: async () => ({ provider: "mcp" }),
			}),
		).toMatchObject({ ok: false, code: "unsupported" });
	});
});

describe("commitSkillUpload", () => {
	it("crear: da de alta la página y después importa el paquete", async () => {
		const { deps: d, save, calls } = deps();
		const result = await commitSkillUpload("acme", FOLDER, pkg(), d);
		expect(result).toEqual({
			ok: true,
			mode: "crear",
			slug: VENTAS,
			name: "facturacion",
			files: 2,
			revision: 6,
		});
		expect(calls).toEqual([
			"save",
			"save",
			"put:references/guia.md",
			"put:scripts/calc.py",
		]);
		expect(save.mock.calls[0][1]).toEqual({
			slug: VENTAS,
			title: "facturacion",
			category: "skill",
			status: "activo",
			tags: [],
			frontmatter: { description: "Usar para emitir facturas." },
			body: "# Facturación\n\nPasos.\n",
			reason: "Alta por subida de paquete",
		});
		expect(save.mock.calls[1][1]).toMatchObject({
			slug: VENTAS,
			reason: "Importación de paquete",
			frontmatter: {
				description: "Usar para emitir facturas.",
				compatibility: "Python 3",
			},
		});
	});

	it("reemplazar: no da de alta, solo importa", async () => {
		const { deps: d, save, calls } = deps({ rows: existing() });
		const result = await commitSkillUpload("acme", FOLDER, pkg(), d);
		expect(result).toEqual({
			ok: true,
			mode: "reemplazar",
			slug: VENTAS,
			name: "facturacion",
			files: 2,
			revision: 5,
		});
		expect(save).toHaveBeenCalledTimes(1);
		expect(save.mock.calls[0][1]).toMatchObject({
			reason: "Importación de paquete",
		});
		expect(calls[0]).toBe("save");
	});

	it("dos veces el mismo paquete: la segunda reemplaza y no duplica archivos", async () => {
		const { deps: d, putFile, removeFile } = deps();
		const first = await commitSkillUpload("acme", FOLDER, pkg(), d);
		expect(first).toMatchObject({ ok: true, mode: "crear", files: 2 });
		putFile.mockClear();
		const second = await commitSkillUpload("acme", FOLDER, pkg(), d);
		expect(second).toMatchObject({ ok: true, mode: "reemplazar", files: 2 });
		expect(putFile.mock.calls.map(([p]) => p.path).sort()).toEqual([
			"references/guia.md",
			"scripts/calc.py",
		]);
		expect(removeFile).not.toHaveBeenCalled();
		const row = (await d.store.overview("t1")).find((r) => r.slug === VENTAS);
		expect(await d.store.files("t1", row?.pageId ?? "")).toHaveLength(2);
	});

	it("un zip inválido no escribe nada", async () => {
		const { deps: d, save, putFile } = deps();
		const result = await commitSkillUpload(
			"acme",
			FOLDER,
			[{ path: "scripts/calc.py", bytes: bytes("x") }],
			d,
		);
		expect(result).toMatchObject({ ok: false, code: "validation" });
		expect(save).not.toHaveBeenCalled();
		expect(putFile).not.toHaveBeenCalled();
	});

	it("los errores del alta se traducen sin revelar permisos", async () => {
		const conflict = deps({ saveError: new BrainConflict(VENTAS, 1) });
		expect(
			await commitSkillUpload("acme", FOLDER, pkg(), conflict.deps),
		).toMatchObject({ ok: false, code: "conflict" });
		expect(conflict.putFile).not.toHaveBeenCalled();

		const forbidden = deps({ saveError: new BrainForbidden("no") });
		expect(
			await commitSkillUpload("acme", FOLDER, pkg(), forbidden.deps),
		).toEqual({ ok: false, code: "not_found", message: "No encontrado." });

		const invalid = deps({
			saveError: new BrainValidation(["body"], "El cuerpo es muy largo."),
		});
		expect(
			await commitSkillUpload("acme", FOLDER, pkg(), invalid.deps),
		).toEqual({
			ok: false,
			code: "validation",
			message: "El cuerpo es muy largo.",
		});
	});

	it("al reemplazar, un BrainForbidden del guardado también es not_found", async () => {
		const { deps: d } = deps({
			rows: existing(),
			saveError: new BrainForbidden("no"),
		});
		expect(await commitSkillUpload("acme", FOLDER, pkg(), d)).toEqual({
			ok: false,
			code: "not_found",
			message: "No encontrado.",
		});
	});

	it("sin permiso para crear: not_found y nada escrito", async () => {
		const { deps: d, save } = deps({
			rules: [members("skills/ventas", "editor")],
		});
		expect(await commitSkillUpload("acme", FOLDER, pkg(), d)).toMatchObject({
			ok: false,
			code: "not_found",
		});
		expect(save).not.toHaveBeenCalled();
	});
});
