// Armado compartido de las pruebas de archivos y de subida de skills: un
// FilesDeps en memoria que registra el orden de las escrituras.
import { vi } from "vitest";
import type { AccessRule } from "@/lib/brain/core/access/types";
import type { FilesDeps } from "@/lib/brain/core/skills/files";
import type { SkillFile } from "@/lib/brain/core/skills/package";
import type { SkillAct, SkillOverviewRow } from "@/lib/brain/core/skills/store";
import type { BrainPage, BrainRole, BrainWrite } from "@/lib/brain/core/types";

export const SLUG = "skills/admin/facturacion";
export const bytes = (text: string) => new TextEncoder().encode(text);
export const SKILL_MD = `---
name: facturacion
description: Usar para emitir y validar facturas.
compatibility: Python 3
---

# Facturación

Pasos.
`;

export const page: BrainPage = {
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

export const published = [{ path: "scripts/calc.py", sha256: "pub", size: 3 }];
export const draftFiles = [
	{ path: "scripts/calc.py", sha256: "draft", size: 3 },
	{ path: "references/nuevo.md", sha256: "solo-borrador", size: 3 },
];
export const oldAct: SkillAct = {
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

export const members = (
	path: string,
	level: AccessRule["level"],
): AccessRule => ({
	path,
	principal: "members",
	userId: null,
	level,
});

export function setupCurrent(): NonNullable<SkillOverviewRow["current"]> {
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

// Fila de una skill existente. La de SLUG (pageId "p1") arranca con draftFiles.
export function skillRow(
	slug: string,
	pageId: string,
	current: SkillOverviewRow["current"] = setupCurrent(),
): SkillOverviewRow {
	return { pageId, slug, revision: 4, draftFilesDigest: "fd", current };
}

// El estado vive en memoria: guardar una página nueva suma su fila y su
// página, y subir o quitar archivos cambia lo que devuelve `files`. Cada
// guardado devuelve la revisión siguiente, empezando en 5.
export function setup(
	opts: {
		role?: BrainRole;
		rules?: AccessRule[];
		current?: SkillOverviewRow["current"];
		putError?: unknown;
		saveError?: unknown;
		files?: SkillFile[];
		rows?: SkillOverviewRow[];
	} = {},
) {
	const blobs = new Map<string, Uint8Array>([
		["t1/pub", bytes("publicado")],
		["t1/draft", bytes("borrador")],
		["t1/solo-borrador", bytes("nuevo")],
		["t1/v1", bytes("viejo")],
	]);
	const rows: SkillOverviewRow[] = opts.rows ?? [
		skillRow(
			SLUG,
			"p1",
			opts.current === undefined ? setupCurrent() : opts.current,
		),
	];
	const pages = new Map<string, BrainPage>(
		rows.map((row) => [row.slug, { ...page, slug: row.slug }]),
	);
	const fileMap = new Map<string, SkillFile[]>(
		rows.map((row) => [
			row.pageId,
			row.pageId === "p1" ? [...(opts.files ?? draftFiles)] : [],
		]),
	);
	const calls: string[] = [];
	let nextRevision = 5;
	const putFile = vi.fn(
		async (p: {
			pageId: string;
			path: string;
			sha256: string;
			size: number;
		}) => {
			if (opts.putError) throw opts.putError;
			calls.push(`put:${p.path}`);
			const list = (fileMap.get(p.pageId) ?? []).filter(
				(file) => file.path !== p.path,
			);
			list.push({ path: p.path, sha256: p.sha256, size: p.size });
			fileMap.set(p.pageId, list);
			return "digest-nuevo";
		},
	);
	const removeFile = vi.fn(async (p: { pageId: string; path: string }) => {
		calls.push(`remove:${p.path}`);
		fileMap.set(
			p.pageId,
			(fileMap.get(p.pageId) ?? []).filter((file) => file.path !== p.path),
		);
		return "digest-nuevo";
	});
	const save = vi.fn(async (_actor: unknown, write: BrainWrite) => {
		if (opts.saveError) throw opts.saveError;
		calls.push("save");
		const revision = nextRevision++;
		if (!rows.some((row) => row.slug === write.slug)) {
			const pageId = `p${rows.length + 1}`;
			rows.push({ ...skillRow(write.slug, pageId, null), revision });
			fileMap.set(pageId, []);
		}
		pages.set(write.slug, {
			slug: write.slug,
			title: write.title,
			category: write.category,
			status: write.status,
			tags: write.tags,
			frontmatter: write.frontmatter ?? {},
			body: write.body,
			revision,
			updatedAt: "2026-10-20T00:00:00Z",
		});
		return { revision };
	});
	const deps: FilesDeps = {
		actor: async () => ({
			tenantId: "t1",
			userId: "ana",
			role: opts.role ?? "tenant_member",
		}),
		binding: async () => ({ provider: "wiki" }),
		rules: { load: async () => opts.rules ?? [members("", "editor")] },
		page: async (_tenantId, slug) => pages.get(slug) ?? null,
		save,
		store: {
			overview: async () => rows.map((row) => ({ ...row })),
			files: async (_tenantId, pageId) => [...(fileMap.get(pageId) ?? [])],
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
	return { deps, putFile, removeFile, save, calls, blobs, rows };
}
