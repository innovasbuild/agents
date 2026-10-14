import { describe, expect, it, vi } from "vitest";
import type { AccessRule } from "@/lib/brain/core/access/types";
import { BrainConflict, BrainNotFound } from "@/lib/brain/core/errors";
import {
	type FilesDeps,
	importSkillPackage,
	parseSkillMd,
	planImport,
	publishedSkillFor,
	putSkillFile,
	readSkillFile,
	removeSkillFile,
	sha256Hex,
} from "@/lib/brain/core/skills/files";
import { MAX_FILE_BYTES } from "@/lib/brain/core/skills/package";
import type { SkillAct, SkillOverviewRow } from "@/lib/brain/core/skills/store";
import type { BrainPage, BrainRole, BrainWrite } from "@/lib/brain/core/types";
import { WikiStoreError } from "@/lib/brain/core/wiki-store";

const SLUG = "skills/admin/facturacion";
const bytes = (text: string) => new TextEncoder().encode(text);
const SKILL_MD = `---
name: facturacion
description: Usar para emitir y validar facturas.
compatibility: Python 3
---

# Facturación

Pasos.
`;

const page: BrainPage = {
	slug: SLUG,
	title: "Facturación",
	category: "skill",
	status: "activo",
	tags: ["finanzas"],
	frontmatter: { description: "vieja", updated: "2026-10-01" },
	body: "viejo",
	revision: 4,
	updatedAt: "2026-10-11T00:00:00Z",
};

const published = [{ path: "scripts/calc.py", sha256: "pub", size: 3 }];
const draftFiles = [
	{ path: "scripts/calc.py", sha256: "draft", size: 3 },
	{ path: "references/nuevo.md", sha256: "solo-borrador", size: 3 },
];
const oldAct: SkillAct = {
	id: 1,
	action: "publicar",
	version: 1,
	pageRevision: 2,
	title: "F",
	description: "d",
	body: "b",
	manifest: [{ path: "scripts/viejo.py", sha256: "v1", size: 3 }],
	digest: "dg",
	note: "n",
	republishedFrom: null,
	actorUserId: null,
	createdAt: "2026-10-01T00:00:00Z",
};

const members = (path: string, level: AccessRule["level"]): AccessRule => ({
	path,
	principal: "members",
	userId: null,
	level,
});

function setup(
	opts: {
		role?: BrainRole;
		rules?: AccessRule[];
		current?: SkillOverviewRow["current"];
		putError?: unknown;
		saveError?: unknown;
		files?: { path: string; sha256: string; size: number }[];
	} = {},
) {
	const blobs = new Map<string, Uint8Array>([
		["t1/pub", bytes("publicado")],
		["t1/draft", bytes("borrador")],
		["t1/solo-borrador", bytes("nuevo")],
		["t1/v1", bytes("viejo")],
	]);
	const calls: string[] = [];
	const putFile = vi.fn(async (p: { path: string }) => {
		if (opts.putError) throw opts.putError;
		calls.push(`put:${p.path}`);
		return "digest-nuevo";
	});
	const removeFile = vi.fn(async (p: { path: string }) => {
		calls.push(`remove:${p.path}`);
		return "digest-nuevo";
	});
	const save = vi.fn(async (_actor: unknown, _write: BrainWrite) => {
		if (opts.saveError) throw opts.saveError;
		calls.push("save");
		return { revision: 5 };
	});
	const deps: FilesDeps = {
		actor: async () => ({
			tenantId: "t1",
			userId: "ana",
			role: opts.role ?? "tenant_member",
		}),
		binding: async () => ({ provider: "wiki" }),
		rules: { load: async () => opts.rules ?? [members("", "editor")] },
		page: async () => page,
		save,
		store: {
			overview: async () => [
				{
					pageId: "p1",
					slug: SLUG,
					revision: 4,
					draftFilesDigest: "fd",
					current:
						opts.current === undefined
							? {
									action: "publicar",
									version: 2,
									pageRevision: 3,
									filesDigest: "fdp",
									title: "F",
									description: "d",
									body: "b",
									frontmatter: {},
									manifest: published,
									digest: "dg",
									publishedAt: "2026-10-10T00:00:00Z",
								}
							: opts.current,
				},
			],
			files: async () => opts.files ?? draftFiles,
			acts: async () => [oldAct],
			putFile,
			removeFile,
			publish: vi.fn(),
			withdraw: vi.fn(),
		},
		blobs: {
			put: vi.fn(async (tenantId, sha, data) => {
				blobs.set(`${tenantId}/${sha}`, data);
			}),
			get: async (tenantId, sha) => blobs.get(`${tenantId}/${sha}`) ?? null,
		},
	};
	return { deps, putFile, removeFile, save, calls, blobs };
}

const LECTOR = { rules: [members("", "lector")] };
const HIDDEN = { rules: [members("", "lector"), members("skills", "ninguno")] };

describe("parseSkillMd", () => {
	it("separa el encabezado del cuerpo", () => {
		expect(parseSkillMd(SKILL_MD)).toEqual({
			description: "Usar para emitir y validar facturas.",
			compatibility: "Python 3",
			license: "",
			body: "# Facturación\n\nPasos.\n",
		});
	});
	it("sin encabezado o con YAML roto devuelve null", () => {
		expect(parseSkillMd("# Solo texto")).toBeNull();
		expect(parseSkillMd("---\ndescription: [1, 2\n---\ncuerpo")).toBeNull();
		expect(parseSkillMd("---\n- lista\n---\ncuerpo")).toBeNull();
	});
});

describe("planImport", () => {
	it("acepta el paquete con o sin carpeta raíz", () => {
		const flat = planImport([
			{ path: "SKILL.md", bytes: bytes(SKILL_MD) },
			{ path: "scripts/calc.py", bytes: bytes("print(1)") },
		]);
		const nested = planImport([
			{ path: "facturacion/SKILL.md", bytes: bytes(SKILL_MD) },
			{ path: "facturacion/scripts/calc.py", bytes: bytes("print(1)") },
		]);
		for (const plan of [flat, nested]) {
			if (!plan.ok) throw new Error(plan.problems.join(" "));
			expect(plan.files.map((f) => f.path)).toEqual(["scripts/calc.py"]);
			expect(plan.skill.description).toMatch(/facturas/);
		}
	});

	it("rechaza entero: sin SKILL.md, ruta inválida o archivo pesado", () => {
		expect(
			planImport([{ path: "scripts/calc.py", bytes: bytes("x") }]),
		).toMatchObject({ ok: false });
		const bad = planImport([
			{ path: "SKILL.md", bytes: bytes(SKILL_MD) },
			{ path: "scripts/../../etc/passwd", bytes: bytes("x") },
			{ path: "pesado.bin", bytes: new Uint8Array(MAX_FILE_BYTES + 1) },
		]);
		if (bad.ok) throw new Error("tenía que fallar");
		expect(bad.problems).toHaveLength(2);
		expect(bad.problems.join(" ")).toContain("scripts/../../etc/passwd");
	});

	it("acepta un archivo vacío, como un __init__.py", () => {
		const plan = planImport([
			{ path: "SKILL.md", bytes: bytes(SKILL_MD) },
			{ path: "scripts/__init__.py", bytes: new Uint8Array() },
		]);
		if (!plan.ok) throw new Error(plan.problems.join(" "));
		expect(plan.files.map((f) => f.path)).toEqual(["scripts/__init__.py"]);
	});

	it("rechaza un SKILL.md sin descripción y más de 50 archivos", () => {
		expect(
			planImport([{ path: "SKILL.md", bytes: bytes("---\nname: x\n---\nc") }]),
		).toMatchObject({ ok: false });
		const many = Array.from({ length: 51 }, (_, i) => ({
			path: `f${i}.txt`,
			bytes: bytes("x"),
		}));
		expect(
			planImport([{ path: "SKILL.md", bytes: bytes(SKILL_MD) }, ...many]),
		).toMatchObject({ ok: false });
	});
});

describe("putSkillFile", () => {
	it("un editor sube: primero el contenido, después la fila con el hash del servidor", async () => {
		const { deps, putFile, blobs } = setup();
		const data = bytes("print(1)");
		const result = await putSkillFile(
			"acme",
			SLUG,
			{ path: "scripts/nuevo.py", bytes: data },
			deps,
		);
		expect(result).toEqual({ ok: true, filesDigest: "digest-nuevo" });
		const sha = sha256Hex(data);
		expect(blobs.get(`t1/${sha}`)).toBe(data);
		expect(putFile).toHaveBeenCalledWith({
			tenantId: "t1",
			pageId: "p1",
			path: "scripts/nuevo.py",
			sha256: sha,
			size: data.length,
			actorUserId: "ana",
		});
	});

	it("un archivo vacío se sube y su contenido queda en <tenant>/<sha256 de cero bytes>", async () => {
		const { deps, putFile, blobs } = setup();
		const empty = new Uint8Array();
		const result = await putSkillFile(
			"acme",
			SLUG,
			{ path: "scripts/__init__.py", bytes: empty },
			deps,
		);
		expect(result).toMatchObject({ ok: true });
		const sha =
			"e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
		expect(sha256Hex(empty)).toBe(sha);
		expect(blobs.get(`t1/${sha}`)).toBe(empty);
		expect(await deps.blobs.get("t1", sha)).toBe(empty);
		expect(putFile).toHaveBeenCalledWith(
			expect.objectContaining({ sha256: sha, size: 0 }),
		);
	});

	it("un lector no sube; quien no ve la skill recibe not_found", async () => {
		const input = { path: "a.txt", bytes: bytes("x") };
		expect(
			await putSkillFile("acme", SLUG, input, setup(LECTOR).deps),
		).toMatchObject({ code: "forbidden" });
		expect(
			await putSkillFile("acme", SLUG, input, setup(HIDDEN).deps),
		).toMatchObject({ code: "not_found" });
	});

	it("ruta inválida o pesado: validación, sin tocar el bucket", async () => {
		const { deps } = setup();
		for (const input of [
			{ path: "../x", bytes: bytes("x") },
			{ path: "SKILL.md", bytes: bytes("x") },
			{ path: "a.bin", bytes: new Uint8Array(MAX_FILE_BYTES + 1) },
		]) {
			expect(await putSkillFile("acme", SLUG, input, deps)).toMatchObject({
				code: "validation",
			});
		}
		expect(deps.blobs.put).not.toHaveBeenCalled();
	});

	it("el tope del paquete que impone la base sale como validación", async () => {
		const { deps } = setup({
			putError: new WikiStoreError(
				"BR422",
				"BRAIN_VALIDATION",
				"package_limit",
			),
		});
		const result = await putSkillFile(
			"acme",
			SLUG,
			{ path: "a.txt", bytes: bytes("x") },
			deps,
		);
		expect(result).toMatchObject({ code: "validation" });
		expect(result.ok === false && result.message).toMatch(/50 archivos/);
	});
});

describe("removeSkillFile", () => {
	it("un editor quita; un lector no", async () => {
		const editor = setup();
		expect(
			await removeSkillFile("acme", SLUG, "scripts/calc.py", editor.deps),
		).toEqual({ ok: true, filesDigest: "digest-nuevo" });
		expect(
			await removeSkillFile(
				"acme",
				SLUG,
				"scripts/calc.py",
				setup(LECTOR).deps,
			),
		).toMatchObject({ code: "forbidden" });
	});
});

describe("readSkillFile", () => {
	const text = (result: Awaited<ReturnType<typeof readSkillFile>>) =>
		result.ok ? new TextDecoder().decode(result.bytes) : result.code;

	it("un editor lee el borrador y cualquier versión", async () => {
		const { deps } = setup();
		expect(
			text(
				await readSkillFile("acme", SLUG, { path: "scripts/calc.py" }, deps),
			),
		).toBe("borrador");
		expect(
			text(
				await readSkillFile(
					"acme",
					SLUG,
					{ path: "scripts/viejo.py", version: 1 },
					deps,
				),
			),
		).toBe("viejo");
	});

	it("un lector lee solo lo que está en la versión vigente", async () => {
		const { deps } = setup(LECTOR);
		expect(
			text(
				await readSkillFile("acme", SLUG, { path: "scripts/calc.py" }, deps),
			),
		).toBe("publicado");
	});

	it("un lector no llega a un archivo del borrador ni a una versión anterior", async () => {
		const { deps } = setup(LECTOR);
		expect(
			text(
				await readSkillFile(
					"acme",
					SLUG,
					{ path: "references/nuevo.md" },
					deps,
				),
			),
		).toBe("not_found");
		expect(
			text(
				await readSkillFile(
					"acme",
					SLUG,
					{ path: "scripts/viejo.py", version: 1 },
					deps,
				),
			),
		).toBe("not_found");
	});

	it("para un lector, una skill retirada o sin publicar no tiene archivos", async () => {
		for (const current of [
			null,
			{ ...setupCurrent(), action: "retirar" as const },
		]) {
			const { deps } = setup({ ...LECTOR, current });
			expect(
				text(
					await readSkillFile("acme", SLUG, { path: "scripts/calc.py" }, deps),
				),
			).toBe("not_found");
		}
	});

	it("quien no ve la skill recibe not_found", async () => {
		expect(
			text(
				await readSkillFile(
					"acme",
					SLUG,
					{ path: "scripts/calc.py" },
					setup(HIDDEN).deps,
				),
			),
		).toBe("not_found");
	});
});

function setupCurrent(): NonNullable<SkillOverviewRow["current"]> {
	return {
		action: "publicar",
		version: 2,
		pageRevision: 3,
		filesDigest: "fdp",
		title: "F",
		description: "d",
		body: "b",
		frontmatter: {},
		manifest: published,
		digest: "dg",
		publishedAt: "2026-10-10T00:00:00Z",
	};
}

describe("importSkillPackage", () => {
	const entries = [
		{ path: "SKILL.md", bytes: bytes(SKILL_MD) },
		{ path: "scripts/calc.py", bytes: bytes("print(2)") },
	];

	it("guarda el borrador, quita lo que el paquete no trae y carga lo nuevo", async () => {
		const { deps, save, calls } = setup();
		const result = await importSkillPackage("acme", SLUG, entries, deps);
		expect(result).toEqual({ ok: true, files: 1, revision: 5 });
		expect(save.mock.calls[0][1]).toMatchObject({
			slug: SLUG,
			title: "Facturación",
			category: "skill",
			tags: ["finanzas"],
			body: "# Facturación\n\nPasos.\n",
			reason: "Importación de paquete",
			baseRevision: 4,
			frontmatter: {
				description: "Usar para emitir y validar facturas.",
				compatibility: "Python 3",
				updated: "2026-10-01",
			},
		});
		// Primero se quita lo viejo: así el tope de 50 no salta a mitad de camino.
		expect(calls).toEqual([
			"save",
			"remove:references/nuevo.md",
			"put:scripts/calc.py",
		]);
	});

	it("un paquete inválido no cambia nada", async () => {
		const { deps, save, putFile } = setup();
		const result = await importSkillPackage(
			"acme",
			SLUG,
			[{ path: "scripts/calc.py", bytes: bytes("x") }],
			deps,
		);
		expect(result).toMatchObject({ code: "validation" });
		expect(save).not.toHaveBeenCalled();
		expect(putFile).not.toHaveBeenCalled();
		expect(deps.blobs.put).not.toHaveBeenCalled();
	});

	it("un lector no importa; si alguien guardó en el medio, conflicto", async () => {
		expect(
			await importSkillPackage("acme", SLUG, entries, setup(LECTOR).deps),
		).toMatchObject({ code: "forbidden" });
		const { deps, putFile } = setup({ saveError: new BrainConflict(SLUG, 5) });
		expect(await importSkillPackage("acme", SLUG, entries, deps)).toMatchObject(
			{ code: "conflict" },
		);
		expect(putFile).not.toHaveBeenCalled();
	});
});

describe("existencia: quien no ve la skill no sabe si existe", () => {
	const input = { path: "a.txt", bytes: bytes("x") };
	const entries = [{ path: "SKILL.md", bytes: bytes(SKILL_MD) }];

	it("un lector de una skill sin publicar o retirada recibe not_found", async () => {
		for (const current of [
			null,
			{ ...setupCurrent(), action: "retirar" as const },
		]) {
			const { deps } = setup({ ...LECTOR, current });
			expect(await putSkillFile("acme", SLUG, input, deps)).toMatchObject({
				code: "not_found",
			});
			expect(await removeSkillFile("acme", SLUG, "a.txt", deps)).toMatchObject({
				code: "not_found",
			});
			expect(
				await importSkillPackage("acme", SLUG, entries, deps),
			).toMatchObject({
				code: "not_found",
			});
		}
	});

	it("un lector de una skill publicada recibe forbidden", async () => {
		const { deps } = setup(LECTOR);
		expect(await removeSkillFile("acme", SLUG, "a.txt", deps)).toMatchObject({
			code: "forbidden",
		});
		expect(await importSkillPackage("acme", SLUG, entries, deps)).toMatchObject(
			{
				code: "forbidden",
			},
		);
	});

	it("quien no tiene acceso recibe not_found al quitar e importar", async () => {
		const { deps } = setup(HIDDEN);
		expect(await removeSkillFile("acme", SLUG, "a.txt", deps)).toMatchObject({
			code: "not_found",
		});
		expect(await importSkillPackage("acme", SLUG, entries, deps)).toMatchObject(
			{
				code: "not_found",
			},
		);
	});

	it("BrainNotFound al guardar el borrador sale como not_found", async () => {
		const { deps } = setup({ saveError: new BrainNotFound(SLUG, []) });
		expect(await importSkillPackage("acme", SLUG, entries, deps)).toMatchObject(
			{
				code: "not_found",
			},
		);
	});
});

describe("endurecimiento del import", () => {
	it("una carpeta raíz inválida (.., ., vacía) no se descarta", () => {
		for (const root of ["..", ".", ""]) {
			const plan = planImport([
				{ path: `${root}/SKILL.md`, bytes: bytes(SKILL_MD) },
				{ path: `${root}/a.txt`, bytes: bytes("x") },
			]);
			expect(plan.ok).toBe(false);
		}
	});

	it("un segundo SKILL.md se informa como repetido", () => {
		const plan = planImport([
			{ path: "SKILL.md", bytes: bytes(SKILL_MD) },
			{ path: "SKILL.md", bytes: bytes(SKILL_MD) },
		]);
		if (plan.ok) throw new Error("tenía que fallar");
		expect(plan.problems.join(" ")).toContain("Ruta repetida: SKILL.md");
	});

	it("compatibility de más de 500 caracteres se rechaza", () => {
		const long = SKILL_MD.replace("Python 3", "x".repeat(501));
		const plan = planImport([{ path: "SKILL.md", bytes: bytes(long) }]);
		if (plan.ok) throw new Error("tenía que fallar");
		expect(plan.problems.join(" ")).toMatch(/compatibility supera los 500/);
	});

	it("el mensaje corta la lista de problemas en 10", async () => {
		const bad = Array.from({ length: 30 }, (_, i) => ({
			path: `../m${i}`,
			bytes: bytes("x"),
		}));
		const result = await importSkillPackage(
			"acme",
			SLUG,
			[{ path: "SKILL.md", bytes: bytes(SKILL_MD) }, ...bad],
			setup().deps,
		);
		if (result.ok) throw new Error("tenía que fallar");
		expect(result.message).toMatch(/ y 20 más\.$/);
		expect(result.message.split("Ruta inválida")).toHaveLength(11);
	});

	it("los archivos que achican se cargan antes que los que agrandan", async () => {
		const { deps, calls } = setup({
			files: [
				{ path: "grande.bin", sha256: "g", size: 10_000_000 },
				{ path: "chico.bin", sha256: "c", size: 1 },
			],
		});
		const result = await importSkillPackage(
			"acme",
			SLUG,
			[
				{ path: "SKILL.md", bytes: bytes(SKILL_MD) },
				{ path: "chico.bin", bytes: new Uint8Array(4_000_000) },
				{ path: "grande.bin", bytes: new Uint8Array(1) },
			],
			deps,
		);
		expect(result).toMatchObject({ ok: true });
		expect(calls.filter((c) => c.startsWith("put:"))).toEqual([
			"put:grande.bin",
			"put:chico.bin",
		]);
	});
});

describe("publishedSkillFor", () => {
	it("un lector recibe la copia publicada con su tenant y su persona", async () => {
		const { deps } = setup(LECTOR);
		const result = await publishedSkillFor("acme", SLUG, deps);
		if (!result.ok) throw new Error(result.message);
		expect(result.slug).toBe(SLUG);
		expect(result.tenantId).toBe("t1");
		expect(result.snapshot.version).toBe(2);
		expect(result.snapshot.manifest).toEqual(published);
	});

	it("un editor también recibe la publicada, no el borrador", async () => {
		const { deps } = setup();
		const result = await publishedSkillFor("acme", SLUG, deps);
		if (!result.ok) throw new Error(result.message);
		expect(result.snapshot.manifest).toEqual(published);
	});

	it("sin publicación vigente, sin lectura o sin ser miembro: not_found", async () => {
		const noMember = setup().deps;
		for (const deps of [
			setup({ current: null }).deps,
			setup(HIDDEN).deps,
			{ ...noMember, actor: async () => null },
		]) {
			expect(await publishedSkillFor("acme", SLUG, deps)).toMatchObject({
				ok: false,
				code: "not_found",
			});
		}
	});
});
