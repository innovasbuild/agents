import { describe, expect, it, vi } from "vitest";
import { resolveAccess } from "@/lib/brain/core/access/resolve-access";
import type { AccessRule, Principal } from "@/lib/brain/core/access/types";
import { BrainConflict, BrainValidation } from "@/lib/brain/core/errors";
import {
	canEditSkills,
	createSkillDrafts,
} from "@/lib/brain/core/skills/draft";
import type { FilesDeps } from "@/lib/brain/core/skills/files";
import type { SkillFile } from "@/lib/brain/core/skills/package";
import type { SkillOverviewRow } from "@/lib/brain/core/skills/store";
import type { BrainPage, BrainRole, BrainWrite } from "@/lib/brain/core/types";
import { WikiStoreError } from "@/lib/brain/core/wiki-store";

const SLUG = "skills/admin/facturacion";
const TENANT = "t1";
const enc = (text: string) => new TextEncoder().encode(text);
const dec = (bytes: Uint8Array) => new TextDecoder().decode(bytes);

const members = (path: string, level: AccessRule["level"]): AccessRule => ({
	path,
	principal: "members",
	userId: null,
	level,
});
const EDITOR = [members("", "editor")];
const LECTOR = [members("", "lector")];

const BODY = "# Facturación\n\nPaso uno.\nPaso dos.\n";

function published(): NonNullable<SkillOverviewRow["current"]> {
	return {
		action: "publicar",
		version: 2,
		pageRevision: 4,
		filesDigest: "fd",
		title: "Facturación",
		description: "pub",
		body: "pub",
		frontmatter: {},
		manifest: [],
		digest: "dg",
		publishedAt: "2026-10-10T00:00:00Z",
	};
}

function skillPage(slug: string, title: string): BrainPage {
	return {
		slug,
		title,
		category: "skill",
		status: "activo",
		tags: ["finanzas"],
		frontmatter: {
			description: "Usar para emitir y validar facturas.",
			compatibility: "Python 3",
			updated: "2026-10-01",
		},
		body: BODY,
		revision: 4,
		updatedAt: "2026-10-11T00:00:00Z",
	};
}

function setup(
	opts: {
		role?: BrainRole;
		rules?: AccessRule[];
		current?: SkillOverviewRow["current"];
		saveError?: unknown;
		twin?: boolean;
	} = {},
) {
	const rules = opts.rules ?? EDITOR;
	const role = opts.role ?? "tenant_member";
	const principal: Principal = { kind: "user", userId: "ana", role };
	const blobs = new Map<string, Uint8Array>([
		[`${TENANT}/h-calc`, enc("print('hola')")],
		[`${TENANT}/h-logo`, new Uint8Array([137, 0, 1])],
	]);
	let files: SkillFile[] = [
		{ path: "scripts/calc.py", sha256: "h-calc", size: 13 },
		{ path: "assets/logo.png", sha256: "h-logo", size: 3 },
	];
	const pages = new Map<string, BrainPage>([
		[SLUG, skillPage(SLUG, "Facturación")],
	]);
	const rows: SkillOverviewRow[] = [
		{
			pageId: "p1",
			slug: SLUG,
			revision: 4,
			draftFilesDigest: "fd",
			current: opts.current === undefined ? published() : opts.current,
		},
	];
	if (opts.twin) {
		const twin = "skills/ventas/facturacion";
		pages.set(twin, skillPage(twin, "Facturación ventas"));
		rows.push({
			pageId: "p2",
			slug: twin,
			revision: 4,
			draftFilesDigest: "fd",
			current: null,
		});
	}

	const save = vi.fn(async (_actor: unknown, write: BrainWrite) => {
		if (opts.saveError) throw opts.saveError;
		const existing = pages.get(write.slug);
		if (write.baseRevision === undefined) {
			if (existing) throw new BrainConflict(write.slug, null);
			pages.set(write.slug, {
				slug: write.slug,
				title: write.title,
				category: write.category,
				status: write.status,
				tags: write.tags,
				frontmatter: write.frontmatter ?? {},
				body: write.body,
				revision: 1,
				updatedAt: "2026-10-15T00:00:00Z",
			});
			rows.push({
				pageId: `p-${write.slug}`,
				slug: write.slug,
				revision: 1,
				draftFilesDigest: "fd0",
				current: null,
			});
			return { revision: 1 };
		}
		if (!existing || existing.revision !== write.baseRevision) {
			throw new BrainConflict(write.slug, existing?.revision ?? null);
		}
		const revision = existing.revision + 1;
		pages.set(write.slug, {
			...existing,
			body: write.body,
			frontmatter: write.frontmatter ?? {},
			revision,
		});
		const row = rows.find((item) => item.slug === write.slug);
		if (row) row.revision = revision;
		return { revision };
	});

	const putFile = vi.fn(
		async (p: { path: string; sha256: string; size: number }) => {
			files = [
				...files.filter((file) => file.path !== p.path),
				{ path: p.path, sha256: p.sha256, size: p.size },
			];
			rows[0].draftFilesDigest = "fd-nuevo";
			return "fd-nuevo";
		},
	);

	const filesDeps: FilesDeps = {
		actor: async () => ({ tenantId: TENANT, userId: "ana", role }),
		binding: async () => ({ provider: "wiki" }),
		rules: { load: async () => rules },
		page: async (_tenantId, slug) => pages.get(slug) ?? null,
		save,
		store: {
			overview: async () => rows,
			files: async () => files,
			acts: async () => [],
			putFile,
			removeFile: vi.fn(),
			publish: vi.fn(),
			withdraw: vi.fn(),
		},
		blobs: {
			put: vi.fn(async (tenantId, sha, bytes) => {
				blobs.set(`${tenantId}/${sha}`, bytes);
			}),
			get: async (tenantId, sha) => blobs.get(`${tenantId}/${sha}`) ?? null,
		},
	};
	const drafts = createSkillDrafts({
		tenantSlug: "acme",
		files: filesDeps,
		levelOf: (path) => resolveAccess(rules, principal, path),
		reviewUrl: (slug) => `https://agents.test/acme/brain/p/${slug}`,
	});
	return {
		drafts,
		save,
		putFile,
		blobs,
		pages,
		rows,
		principal,
		files: () => files,
	};
}

describe("resolver la skill", () => {
	it("se encuentra por nombre y por ruta completa", async () => {
		const { drafts } = setup();
		const byName = await drafts.read({ skill: "facturacion" });
		const bySlug = await drafts.read({ skill: SLUG });
		expect(byName.slug).toBe(SLUG);
		expect(bySlug.slug).toBe(SLUG);
	});

	it("un lector recibe el mismo error que si la skill no existiera", async () => {
		const { drafts } = setup({ rules: LECTOR });
		const hidden = await drafts
			.read({ skill: "facturacion" })
			.catch((error: Error) => error);
		const missing = await drafts
			.read({ skill: "inexistente" })
			.catch((error: Error) => error);
		expect(hidden).toMatchObject({ code: "not_found" });
		expect(missing).toMatchObject({ code: "not_found" });
		expect((hidden as Error).message.replace("facturacion", "X")).toBe(
			(missing as Error).message.replace("inexistente", "X"),
		);
	});

	it("un editor de otra carpeta no ve esta skill", async () => {
		const { drafts } = setup({
			rules: [members("", "lector"), members("skills/ventas", "editor")],
		});
		await expect(drafts.read({ skill: "facturacion" })).rejects.toMatchObject({
			code: "not_found",
		});
	});

	it("con el mismo nombre en dos carpetas pide la ruta completa y las lista", async () => {
		const { drafts } = setup({ twin: true });
		await expect(drafts.read({ skill: "facturacion" })).rejects.toMatchObject({
			code: "validation",
			message: expect.stringContaining("skills/ventas/facturacion"),
		});
		const exact = await drafts.read({ skill: "skills/ventas/facturacion" });
		expect(exact.slug).toBe("skills/ventas/facturacion");
	});
});

describe("skill_draft_read", () => {
	it("sin ruta devuelve el SKILL.md del borrador, la revisión, el estado y los archivos", async () => {
		const { drafts } = setup();
		const result = await drafts.read({ skill: "facturacion" });
		expect(result).toMatchObject({
			slug: SLUG,
			name: "facturacion",
			revision: 4,
			state: "al_dia",
			publishedVersion: 2,
			reviewUrl: `https://agents.test/acme/brain/p/${SLUG}`,
			files: [
				{ path: "scripts/calc.py", size: 13, readable: true },
				{ path: "assets/logo.png", size: 3, readable: true },
			],
		});
		const skillMd = result.skillMd as string;
		expect(skillMd.startsWith("---\nname: facturacion\n")).toBe(true);
		expect(skillMd).toContain(
			"description: Usar para emitir y validar facturas.",
		);
		expect(skillMd).toContain("compatibility: Python 3");
		expect(skillMd.endsWith(BODY)).toBe(true);
	});

	it("el estado distingue sin publicar, con cambios, al día y retirada", async () => {
		const sin = await setup({ current: null }).drafts.read({
			skill: "facturacion",
		});
		const cambios = await setup({
			current: { ...published(), pageRevision: 3 },
		}).drafts.read({ skill: "facturacion" });
		const retirada = await setup({
			current: { ...published(), action: "retirar" },
		}).drafts.read({ skill: "facturacion" });
		expect(sin).toMatchObject({
			state: "sin_publicar",
			publishedVersion: null,
		});
		expect(cambios).toMatchObject({
			state: "con_cambios",
			publishedVersion: 2,
		});
		expect(retirada).toMatchObject({
			state: "retirada",
			publishedVersion: null,
		});
	});

	it("con ruta devuelve el archivo de texto del borrador", async () => {
		const { drafts } = setup();
		const result = await drafts.read({
			skill: "facturacion",
			path: "scripts/calc.py",
		});
		expect(result).toMatchObject({
			path: "scripts/calc.py",
			size: 13,
			content: "print('hola')",
		});
	});

	it("un binario, una ruta que no está y un archivo de más de 256 KB no se leen", async () => {
		const { drafts, files, blobs } = setup();
		await expect(
			drafts.read({ skill: "facturacion", path: "assets/logo.png" }),
		).rejects.toMatchObject({ code: "validation" });
		await expect(
			drafts.read({ skill: "facturacion", path: "no/esta.md" }),
		).rejects.toMatchObject({ code: "not_found" });
		blobs.set(`${TENANT}/h-big`, new Uint8Array(262_145).fill(97));
		files().push({ path: "references/big.md", sha256: "h-big", size: 262_145 });
		await expect(
			drafts.read({ skill: "facturacion", path: "references/big.md" }),
		).rejects.toMatchObject({
			code: "validation",
			message: expect.stringContaining("256 KB"),
		});
	});

	it("pedir SKILL.md como ruta devuelve lo mismo que no pasar ruta", async () => {
		const { drafts } = setup();
		const sin = await drafts.read({ skill: "facturacion" });
		const con = await drafts.read({ skill: "facturacion", path: "SKILL.md" });
		expect(con).toEqual(sin);
	});
});

describe("canEditSkills", () => {
	it("un administrador siempre", () => {
		const principal: Principal = {
			kind: "user",
			userId: "x",
			role: "tenant_admin",
		};
		expect(canEditSkills([], principal, [])).toBe(true);
	});

	it("un editor general edita bajo skills/, aunque no haya ninguna skill", () => {
		const principal: Principal = {
			kind: "user",
			userId: "x",
			role: "tenant_member",
		};
		expect(canEditSkills(EDITOR, principal, [])).toBe(true);
	});

	it("un lector no", () => {
		const principal: Principal = {
			kind: "user",
			userId: "x",
			role: "tenant_member",
		};
		expect(canEditSkills(LECTOR, principal, [])).toBe(false);
	});

	it("un lector con una regla personal de editor en una carpeta de skills sí", () => {
		const principal: Principal = {
			kind: "user",
			userId: "x",
			role: "tenant_member",
		};
		const rules: AccessRule[] = [
			members("", "lector"),
			{
				path: "skills/ventas",
				principal: "user",
				userId: "x",
				level: "editor",
			},
		];
		expect(canEditSkills(rules, principal, [])).toBe(true);
	});

	it("la regla personal de otra persona no cuenta", () => {
		const principal: Principal = {
			kind: "user",
			userId: "x",
			role: "tenant_member",
		};
		const rules: AccessRule[] = [
			members("", "lector"),
			{
				path: "skills/ventas",
				principal: "user",
				userId: "otro",
				level: "editor",
			},
		];
		expect(canEditSkills(rules, principal, [])).toBe(false);
	});

	it("editor de una skill existente alcanza", () => {
		const principal: Principal = {
			kind: "user",
			userId: "x",
			role: "tenant_member",
		};
		const rules: AccessRule[] = [
			members("", "lector"),
			{ path: SLUG, principal: "user", userId: "x", level: "editor" },
		];
		const row: SkillOverviewRow = {
			pageId: "p1",
			slug: SLUG,
			revision: 1,
			draftFilesDigest: "fd",
			current: null,
		};
		expect(canEditSkills(rules, principal, [row])).toBe(true);
	});
});

describe("skill_draft_edit · SKILL.md", () => {
	it("cambia el cuerpo, guarda con la revisión leída y deja el motivo", async () => {
		const { drafts, save, pages } = setup();
		const result = await drafts.edit({
			skill: "facturacion",
			old: "Paso dos.",
			new: "Paso dos y tres.",
			reason: "sumo un paso",
		});
		expect(save).toHaveBeenCalledTimes(1);
		const write = save.mock.calls[0][1];
		expect(write).toMatchObject({
			slug: SLUG,
			title: "Facturación",
			category: "skill",
			status: "activo",
			tags: ["finanzas"],
			body: "# Facturación\n\nPaso uno.\nPaso dos y tres.\n",
			reason: "Edición por MCP: sumo un paso",
			baseRevision: 4,
		});
		expect(write.frontmatter).toMatchObject({
			description: "Usar para emitir y validar facturas.",
			compatibility: "Python 3",
			updated: "2026-10-01",
		});
		expect(pages.get(SLUG)?.revision).toBe(5);
		expect(result).toMatchObject({
			slug: SLUG,
			path: "SKILL.md",
			revision: 5,
			state: "con_cambios",
			reviewUrl: `https://agents.test/acme/brain/p/${SLUG}`,
		});
		expect(result.message).toContain("borrador");
	});

	it("cambia la description desde el encabezado", async () => {
		const { drafts, save } = setup();
		await drafts.edit({
			skill: "facturacion",
			old: "Usar para emitir y validar facturas.",
			new: "Usar para facturar.",
			reason: "más corta",
		});
		expect(save.mock.calls[0][1].frontmatter).toMatchObject({
			description: "Usar para facturar.",
		});
	});

	it("quita compatibility si se borra la línea", async () => {
		const { drafts, save } = setup();
		await drafts.edit({
			skill: "facturacion",
			old: "compatibility: Python 3\n",
			new: "",
			reason: "ya no hace falta",
		});
		expect(save.mock.calls[0][1].frontmatter).not.toHaveProperty(
			"compatibility",
		);
	});

	it("escribe literal un texto con $& o $1", async () => {
		const { drafts, save } = setup();
		await drafts.edit({
			skill: "facturacion",
			old: "Paso dos.",
			new: "Cobrar $& más $1 y $$.",
			reason: "precio",
		});
		expect(save.mock.calls[0][1].body).toContain("Cobrar $& más $1 y $$.");
	});

	it("rechaza un fragmento vacío, ausente o repetido sin guardar", async () => {
		const { drafts, save } = setup();
		const base = { skill: "facturacion", new: "x", reason: "r" };
		await expect(drafts.edit({ ...base, old: "" })).rejects.toMatchObject({
			code: "validation",
		});
		await expect(
			drafts.edit({ ...base, old: "no está en el texto" }),
		).rejects.toMatchObject({
			code: "validation",
			message: expect.stringContaining("no aparece"),
		});
		await expect(drafts.edit({ ...base, old: "Paso" })).rejects.toMatchObject({
			code: "validation",
			message: expect.stringContaining("2 veces"),
		});
		expect(save).not.toHaveBeenCalled();
	});

	it("rechaza dejar la skill sin description o con una de más de 1024", async () => {
		const { drafts, save } = setup();
		await expect(
			drafts.edit({
				skill: "facturacion",
				old: "description: Usar para emitir y validar facturas.\n",
				new: "",
				reason: "r",
			}),
		).rejects.toMatchObject({ code: "validation" });
		await expect(
			drafts.edit({
				skill: "facturacion",
				old: "Usar para emitir y validar facturas.",
				new: "x".repeat(1025),
				reason: "r",
			}),
		).rejects.toMatchObject({
			code: "validation",
			message: expect.stringContaining("1024"),
		});
		expect(save).not.toHaveBeenCalled();
	});

	it("rechaza romper el encabezado o cambiar name", async () => {
		const { drafts, save } = setup();
		await expect(
			drafts.edit({
				skill: "facturacion",
				old: "---\nname: facturacion",
				new: "name: facturacion",
				reason: "r",
			}),
		).rejects.toMatchObject({
			code: "validation",
			message: expect.stringContaining("encabezado"),
		});
		await expect(
			drafts.edit({
				skill: "facturacion",
				old: "name: facturacion",
				new: "name: otra",
				reason: "r",
			}),
		).rejects.toMatchObject({
			code: "validation",
			message: expect.stringContaining("name"),
		});
		expect(save).not.toHaveBeenCalled();
	});

	it("rechaza una clave del encabezado que no se guarda, sin guardar", async () => {
		const { drafts, save } = setup();
		await expect(
			drafts.edit({
				skill: "facturacion",
				old: "name: facturacion",
				new: "name: facturacion\nallowed-tools: Bash",
				reason: "r",
			}),
		).rejects.toMatchObject({
			code: "validation",
			message: expect.stringMatching(
				/allowed-tools.*name, description, license, compatibility/s,
			),
		});
		expect(save).not.toHaveBeenCalled();
	});

	it("rechaza un cuerpo de más de 100 KB", async () => {
		const { drafts, save } = setup();
		await expect(
			drafts.edit({
				skill: "facturacion",
				old: "Paso uno.",
				new: "x".repeat(102_401),
				reason: "r",
			}),
		).rejects.toMatchObject({ code: "validation" });
		expect(save).not.toHaveBeenCalled();
	});

	it("un borrador que venía sin description se puede seguir editando", async () => {
		const { drafts, pages, save } = setup();
		const page = pages.get(SLUG);
		if (page) page.frontmatter = { updated: "2026-10-01" };
		await drafts.edit({
			skill: "facturacion",
			old: "Paso uno.",
			new: "Primero.",
			reason: "r",
		});
		expect(save).toHaveBeenCalledTimes(1);
	});

	it("si alguien guardó en el medio devuelve un conflicto que dice qué hacer", async () => {
		const { drafts } = setup({ saveError: new BrainConflict(SLUG, 5) });
		await expect(
			drafts.edit({
				skill: "facturacion",
				old: "Paso uno.",
				new: "Primero.",
				reason: "r",
			}),
		).rejects.toMatchObject({
			code: "conflict",
			message: expect.stringContaining("skill_draft_read"),
		});
	});

	it("un lector y el editor de otra carpeta reciben not_found", async () => {
		const input = {
			skill: "facturacion",
			old: "Paso uno.",
			new: "x",
			reason: "r",
		};
		const lector = setup({ rules: LECTOR });
		await expect(lector.drafts.edit(input)).rejects.toMatchObject({
			code: "not_found",
		});
		expect(lector.save).not.toHaveBeenCalled();
		const otro = setup({
			rules: [members("", "lector"), members("skills/ventas", "editor")],
		});
		await expect(otro.drafts.edit(input)).rejects.toMatchObject({
			code: "not_found",
		});
	});
});

describe("skill_draft_edit · archivos", () => {
	it("cambia un archivo de texto y lo sube con su hash", async () => {
		const { drafts, putFile, blobs } = setup();
		const result = await drafts.edit({
			skill: "facturacion",
			path: "scripts/calc.py",
			old: "hola",
			new: "chau",
			reason: "saludo",
		});
		expect(putFile).toHaveBeenCalledWith(
			expect.objectContaining({ path: "scripts/calc.py", size: 13 }),
		);
		const sha = putFile.mock.calls[0][0].sha256;
		expect(dec(blobs.get(`${TENANT}/${sha}`) as Uint8Array)).toBe(
			"print('chau')",
		);
		expect(result).toMatchObject({
			path: "scripts/calc.py",
			state: "con_cambios",
		});
		expect(result.revision).toBeUndefined();
	});

	it("rechaza un binario, un archivo que no está y un fragmento ausente", async () => {
		const { drafts, putFile } = setup();
		const base = { skill: "facturacion", old: "a", new: "b", reason: "r" };
		await expect(
			drafts.edit({ ...base, path: "assets/logo.png" }),
		).rejects.toMatchObject({ code: "validation" });
		await expect(
			drafts.edit({ ...base, path: "no/esta.md" }),
		).rejects.toMatchObject({ code: "not_found" });
		await expect(
			drafts.edit({ ...base, path: "scripts/calc.py", old: "zzz" }),
		).rejects.toMatchObject({ code: "validation" });
		expect(putFile).not.toHaveBeenCalled();
	});

	it("rechaza un resultado de más de 256 KB", async () => {
		const { drafts, putFile } = setup();
		await expect(
			drafts.edit({
				skill: "facturacion",
				path: "scripts/calc.py",
				old: "hola",
				new: "x".repeat(262_144),
				reason: "r",
			}),
		).rejects.toMatchObject({ code: "validation" });
		expect(putFile).not.toHaveBeenCalled();
	});
});

describe("skill_draft_write_file", () => {
	it("crea un archivo de texto del paquete", async () => {
		const { drafts, putFile, blobs } = setup();
		const result = await drafts.writeFile({
			skill: "facturacion",
			path: "references/guia.md",
			content: "# Guía\n",
		});
		expect(putFile).toHaveBeenCalledWith(
			expect.objectContaining({ path: "references/guia.md", size: 8 }),
		);
		const sha = putFile.mock.calls[0][0].sha256;
		expect(dec(blobs.get(`${TENANT}/${sha}`) as Uint8Array)).toBe("# Guía\n");
		expect(result).toMatchObject({
			path: "references/guia.md",
			state: "con_cambios",
		});
	});

	it("reemplaza un archivo que ya estaba", async () => {
		const { drafts, files } = setup();
		await drafts.writeFile({
			skill: "facturacion",
			path: "scripts/calc.py",
			content: "print('nuevo')",
		});
		expect(files().filter((f) => f.path === "scripts/calc.py")).toHaveLength(1);
	});

	it("SKILL.md no es un archivo del paquete y manda a skill_draft_edit", async () => {
		const { drafts, putFile } = setup();
		await expect(
			drafts.writeFile({
				skill: "facturacion",
				path: "SKILL.md",
				content: "x",
			}),
		).rejects.toMatchObject({
			code: "validation",
			message: expect.stringContaining("skill_draft_edit"),
		});
		expect(putFile).not.toHaveBeenCalled();
	});

	it("rechaza rutas inválidas y contenido de más de 256 KB", async () => {
		const { drafts, putFile } = setup();
		await expect(
			drafts.writeFile({ skill: "facturacion", path: "../x.md", content: "x" }),
		).rejects.toMatchObject({ code: "validation" });
		await expect(
			drafts.writeFile({
				skill: "facturacion",
				path: "references/big.md",
				content: "x".repeat(262_145),
			}),
		).rejects.toMatchObject({ code: "validation" });
		expect(putFile).not.toHaveBeenCalled();
	});

	it("el tope de archivos de la base se traduce a un error de validación", async () => {
		const { drafts, putFile } = setup();
		putFile.mockRejectedValueOnce(
			new WikiStoreError("BR422", "x", "package_limit"),
		);
		await expect(
			drafts.writeFile({
				skill: "facturacion",
				path: "references/uno.md",
				content: "x",
			}),
		).rejects.toMatchObject({
			code: "validation",
			message: expect.stringContaining("50 archivos"),
		});
	});

	it("un lector recibe not_found", async () => {
		const { drafts, putFile } = setup({ rules: LECTOR });
		await expect(
			drafts.writeFile({
				skill: "facturacion",
				path: "references/guia.md",
				content: "x",
			}),
		).rejects.toMatchObject({ code: "not_found" });
		expect(putFile).not.toHaveBeenCalled();
	});
});

describe("skill_create", () => {
	const input = {
		name: "reporte-mensual",
		folder: "admin",
		description: "Armar el reporte mensual.",
		instructions: "# Reporte\n\nPasos.\n",
		reason: "primer borrador",
	};

	it("crea el borrador sin pisar nada: sin baseRevision, categoría skill, título por defecto", async () => {
		const { drafts, save } = setup();
		const result = await drafts.create(input);
		const write = save.mock.calls[0][1];
		expect(write).toMatchObject({
			slug: "skills/admin/reporte-mensual",
			title: "reporte-mensual",
			category: "skill",
			status: "activo",
			tags: [],
			body: "# Reporte\n\nPasos.\n",
			frontmatter: { description: "Armar el reporte mensual." },
			reason: "Alta por MCP: primer borrador",
		});
		expect(write.baseRevision).toBeUndefined();
		expect(result).toMatchObject({
			slug: "skills/admin/reporte-mensual",
			name: "reporte-mensual",
			path: "SKILL.md",
			revision: 1,
			state: "sin_publicar",
			reviewUrl:
				"https://agents.test/acme/brain/p/skills/admin/reporte-mensual",
		});
	});

	it("la skill creada se puede leer y editar enseguida, y los demás no la ven publicada", async () => {
		const { drafts, rows } = setup();
		await drafts.create(input);
		const read = await drafts.read({ skill: "reporte-mensual" });
		expect(read).toMatchObject({ state: "sin_publicar", revision: 1 });
		expect(
			rows.find((r) => r.slug === "skills/admin/reporte-mensual")?.current,
		).toBeNull();
	});

	it("sin carpeta cae directo bajo skills/, con compatibility y título propio", async () => {
		const { drafts, save } = setup();
		await drafts.create({
			...input,
			folder: undefined,
			title: "Reporte mensual",
			compatibility: "Python 3",
		});
		expect(save.mock.calls[0][1]).toMatchObject({
			slug: "skills/reporte-mensual",
			title: "Reporte mensual",
			frontmatter: {
				description: "Armar el reporte mensual.",
				compatibility: "Python 3",
			},
		});
	});

	it("rechaza nombres, carpetas, textos y largos inválidos sin guardar", async () => {
		const { drafts, save } = setup();
		for (const bad of [
			{ name: "Reporte Mensual" },
			{ name: "a/b" },
			{ name: "x".repeat(65) },
			{ folder: "Admin" },
			{ description: "   " },
			{ description: "x".repeat(1025) },
			{ compatibility: "x".repeat(501) },
			{ instructions: "   " },
			{ instructions: "x".repeat(102_401) },
		]) {
			await expect(drafts.create({ ...input, ...bad })).rejects.toMatchObject({
				code: "validation",
			});
		}
		expect(save).not.toHaveBeenCalled();
	});

	it("un lector no crea, y un editor solo crea en su carpeta", async () => {
		const lector = setup({ rules: LECTOR });
		await expect(lector.drafts.create(input)).rejects.toMatchObject({
			code: "forbidden",
		});
		expect(lector.save).not.toHaveBeenCalled();

		const ventas = setup({
			rules: [members("", "lector"), members("skills/ventas", "editor")],
		});
		await expect(ventas.drafts.create(input)).rejects.toMatchObject({
			code: "forbidden",
		});
		await ventas.drafts.create({ ...input, folder: "ventas" });
		expect(ventas.save).toHaveBeenCalledTimes(1);
	});

	it("si la ruta ya existe, conflicto que manda a skill_draft_edit", async () => {
		const { drafts } = setup();
		await expect(
			drafts.create({ ...input, name: "facturacion" }),
		).rejects.toMatchObject({
			code: "conflict",
			message: expect.stringContaining("skill_draft_edit"),
		});
	});

	it("si la carpeta no existe, el error del guardado llega tal cual", async () => {
		const { drafts } = setup({
			saveError: new BrainValidation(
				["folder"],
				"No existe la carpeta skills/nueva. Pedile a un administrador que la cree.",
			),
		});
		await expect(
			drafts.create({ ...input, folder: "nueva" }),
		).rejects.toMatchObject({
			code: "validation",
			message: expect.stringContaining("No existe la carpeta"),
		});
	});
});
