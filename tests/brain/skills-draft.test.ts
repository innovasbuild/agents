import { describe, expect, it, vi } from "vitest";
import { resolveAccess } from "@/lib/brain/core/access/resolve-access";
import type { AccessRule, Principal } from "@/lib/brain/core/access/types";
import { BrainConflict } from "@/lib/brain/core/errors";
import {
	canEditSkills,
	createSkillDrafts,
} from "@/lib/brain/core/skills/draft";
import type { FilesDeps } from "@/lib/brain/core/skills/files";
import type { SkillFile } from "@/lib/brain/core/skills/package";
import type { SkillOverviewRow } from "@/lib/brain/core/skills/store";
import type { BrainPage, BrainRole, BrainWrite } from "@/lib/brain/core/types";

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
