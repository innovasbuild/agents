import { describe, expect, it, vi } from "vitest";
import {
	type PublishDeps,
	previewPublish,
	publishSkill,
	republishSkill,
	withdrawSkill,
} from "@/lib/brain/core/skills/publish";
import type {
	SkillAct,
	SkillOverviewRow,
	SkillStore,
} from "@/lib/brain/core/skills/store";
import type {
	BrainPage,
	BrainRevision,
	BrainRole,
} from "@/lib/brain/core/types";
import { WikiStoreError } from "@/lib/brain/core/wiki-store";
import {
	canPublishSkill,
	limitMessage,
	type TenantPlan,
} from "@/lib/plans/limits";

const SLUG = "skills/admin/facturacion";
const file = (path: string, sha: string, size = 10) => ({
	path,
	sha256: sha,
	size,
});

const draftPage: BrainPage = {
	slug: SLUG,
	title: "Facturación",
	category: "skill",
	status: "activo",
	tags: [],
	frontmatter: { description: "Usar para facturar." },
	body: "cuerpo nuevo",
	revision: 7,
	updatedAt: "2026-10-11T00:00:00Z",
};

const publishedAct: SkillAct = {
	id: 1,
	action: "publicar",
	version: 1,
	pageRevision: 5,
	title: "Facturación",
	description: "Usar para facturar (v1).",
	body: "cuerpo viejo",
	manifest: [file("scripts/calc.py", "a"), file("assets/viejo.png", "b")],
	digest: "dg1",
	note: "primera",
	republishedFrom: null,
	actorUserId: "admin1",
	createdAt: "2026-10-10T00:00:00Z",
};

const revision = (n: number, author: string | null): BrainRevision => ({
	revision: n,
	title: "Facturación",
	category: "skill",
	status: "activo",
	tags: [],
	frontmatter: {},
	body: "x",
	authorKind: "user",
	authorUserId: author,
	reason: "r",
	createdAt: "2026-10-11T00:00:00Z",
});

const PUBLISHED_CURRENT: NonNullable<SkillOverviewRow["current"]> = {
	action: "publicar",
	version: 1,
	pageRevision: 5,
	filesDigest: "fd5",
	title: "Facturación",
	description: "Usar para facturar (v1).",
	body: "cuerpo viejo",
	frontmatter: {},
	manifest: publishedAct.manifest,
	digest: "dg1",
	publishedAt: "2026-10-10T00:00:00Z",
};
const planOf = (over: Partial<TenantPlan>): TenantPlan => ({
	plan: "free",
	suspendedReason: null,
	trialEndsAt: null,
	aiMonthlyLimitUsd: 5,
	...over,
});
const FREE = planOf({});
const PAGO = planOf({ plan: "pago", aiMonthlyLimitUsd: null });
const DRAFT_ROW: SkillOverviewRow = {
	pageId: "p1",
	slug: SLUG,
	revision: 7,
	draftFilesDigest: "fd7",
	current: null,
};
const PUBLISH_INPUT = {
	expectedRevision: 7,
	expectedFilesDigest: "fd7",
	note: "n",
};

function setup(
	opts: {
		role?: BrainRole;
		provider?: "wiki" | "mcp";
		row?: SkillOverviewRow | null;
		page?: BrainPage | null;
		publishError?: unknown;
		acts?: SkillAct[];
		plan?: TenantPlan | null | "throws";
		// Cuántas skills publicadas hay en la empresa (incluida o no esta).
		othersPublished?: number;
	} = {},
) {
	const row: SkillOverviewRow | null =
		opts.row === undefined
			? {
					pageId: "p1",
					slug: SLUG,
					revision: 7,
					draftFilesDigest: "fd7",
					current: {
						action: "publicar",
						version: 1,
						pageRevision: 5,
						filesDigest: "fd5",
						title: "Facturación",
						description: "Usar para facturar (v1).",
						body: "cuerpo viejo",
						frontmatter: {},
						manifest: publishedAct.manifest,
						digest: "dg1",
						publishedAt: "2026-10-10T00:00:00Z",
					},
				}
			: opts.row;
	const others: SkillOverviewRow[] = Array.from(
		{ length: opts.othersPublished ?? 0 },
		(_, i) => ({
			pageId: `o${i}`,
			slug: `skills/admin/otra-${i}`,
			revision: 1,
			draftFilesDigest: "x",
			current: { ...(row?.current ?? PUBLISHED_CURRENT), action: "publicar" },
		}),
	);
	const publish = vi.fn(async () => {
		if (opts.publishError) throw opts.publishError;
		return { version: 2, digest: "dg2" };
	});
	const withdraw = vi.fn(async () => true);
	const store: SkillStore = {
		overview: async () => (row ? [row, ...others] : others),
		files: async () => [
			file("scripts/calc.py", "a2"),
			file("references/guia.md", "c"),
		],
		acts: async () => opts.acts ?? [publishedAct],
		putFile: vi.fn(),
		removeFile: vi.fn(),
		publish,
		withdraw,
	};
	const deps: PublishDeps = {
		actor: async () => ({
			tenantId: "t1",
			userId: "admin1",
			role: opts.role ?? "tenant_admin",
		}),
		binding: async () => ({ provider: opts.provider ?? "wiki" }),
		page: async () => (opts.page === undefined ? draftPage : opts.page),
		revisions: async () => [
			revision(7, "beto"),
			revision(6, "ana"),
			revision(5, "viejo"),
		],
		store,
		// Misma lógica que el adaptador de producción, con el plan de la prueba.
		skillLimit: async (_tenantId, publishedSkills) => {
			if (opts.plan === "throws") throw new Error("db caída");
			const plan = opts.plan === undefined ? PAGO : opts.plan;
			if (!plan) return null;
			const reason = canPublishSkill(plan, {
				users: 0,
				pendingInvitations: 0,
				publishedSkills,
			});
			return reason ? { reason, message: limitMessage(reason).title } : null;
		},
	};
	return { deps, publish, withdraw };
}

describe("previewPublish", () => {
	it("compara el borrador con la última publicación", async () => {
		const { deps } = setup();
		const result = await previewPublish("acme", SLUG, deps);
		if (!result.ok) throw new Error(result.message);
		const { preview } = result;
		expect(preview.name).toBe("facturacion");
		expect(preview.revision).toBe(7);
		expect(preview.filesDigest).toBe("fd7");
		expect(preview.state).toEqual({
			kind: "publicada",
			version: 1,
			dirty: true,
		});
		expect(preview.body).toBe("cuerpo nuevo");
		expect(preview.previousBody).toBe("cuerpo viejo");
		expect(preview.files.added.map((f) => f.path)).toEqual([
			"references/guia.md",
		]);
		expect(preview.files.changed.map((f) => f.path)).toEqual([
			"scripts/calc.py",
		]);
		expect(preview.files.removed.map((f) => f.path)).toEqual([
			"assets/viejo.png",
		]);
		// Solo quienes editaron después de la revisión publicada (5).
		expect(preview.editorIds.sort()).toEqual(["ana", "beto"]);
		expect(preview.problems).toEqual([]);
	});

	it("sin publicación previa todo es agregado", async () => {
		const { deps } = setup({
			acts: [],
			row: {
				pageId: "p1",
				slug: SLUG,
				revision: 7,
				draftFilesDigest: "fd7",
				current: null,
			},
		});
		const result = await previewPublish("acme", SLUG, deps);
		if (!result.ok) throw new Error(result.message);
		expect(result.preview.previousBody).toBeNull();
		expect(result.preview.files.added).toHaveLength(2);
		expect(result.preview.state).toEqual({ kind: "sin_publicar" });
	});
});

describe("quién publica", () => {
	it("un miembro recibe forbidden aunque sea editor, exista o no la skill", async () => {
		for (const row of [undefined, null]) {
			const { deps, publish } = setup({ role: "tenant_member", row });
			const result = await publishSkill(
				"acme",
				SLUG,
				{ expectedRevision: 7, expectedFilesDigest: "fd7", note: "n" },
				deps,
			);
			expect(result).toMatchObject({ ok: false, code: "forbidden" });
			expect(publish).not.toHaveBeenCalled();
		}
	});

	it("un administrador publica con lo que revisó", async () => {
		const { deps, publish } = setup();
		const result = await publishSkill(
			"acme",
			SLUG,
			{ expectedRevision: 7, expectedFilesDigest: "fd7", note: "  ajuste  " },
			deps,
		);
		expect(result).toEqual({ ok: true, version: 2 });
		expect(publish).toHaveBeenCalledWith({
			tenantId: "t1",
			pageId: "p1",
			expectedRevision: 7,
			expectedFilesDigest: "fd7",
			note: "ajuste",
			actorUserId: "admin1",
			fromVersion: null,
		});
	});

	it("platform_admin también publica", async () => {
		const { deps } = setup({ role: "platform_admin" });
		expect(
			await publishSkill(
				"acme",
				SLUG,
				{ expectedRevision: 7, expectedFilesDigest: "fd7", note: "n" },
				deps,
			),
		).toMatchObject({ ok: true });
	});
});

describe("rechazos al publicar", () => {
	const input = { expectedRevision: 7, expectedFilesDigest: "fd7", note: "n" };

	it("sin nota", async () => {
		const { deps, publish } = setup();
		expect(
			await publishSkill("acme", SLUG, { ...input, note: "   " }, deps),
		).toMatchObject({ ok: false, code: "validation" });
		expect(publish).not.toHaveBeenCalled();
	});

	it("sin descripción no llega a la base", async () => {
		const { deps, publish } = setup({
			page: { ...draftPage, frontmatter: {} },
		});
		const result = await publishSkill("acme", SLUG, input, deps);
		expect(result).toMatchObject({ ok: false, code: "validation" });
		expect(result.ok === false && result.message).toMatch(/descripción/);
		expect(publish).not.toHaveBeenCalled();
	});

	it("el borrador cambió mientras revisaba: conflicto", async () => {
		const { deps } = setup({
			publishError: new WikiStoreError("BR409", "BRAIN_CONFLICT", "files"),
		});
		expect(await publishSkill("acme", SLUG, input, deps)).toMatchObject({
			ok: false,
			code: "conflict",
		});
	});

	it("otra skill vigente con el mismo nombre: el mensaje la nombra", async () => {
		const { deps } = setup({
			publishError: new WikiStoreError("BR409", "BRAIN_CONFLICT", "name"),
		});
		const result = await publishSkill("acme", SLUG, input, deps);
		expect(result).toMatchObject({ ok: false, code: "name_taken" });
		expect(result.ok === false && result.message).toContain("facturacion");
	});

	it("brain externo: unsupported; fuera de skills/: not_found", async () => {
		const { deps } = setup({ provider: "mcp" });
		expect(await publishSkill("acme", SLUG, input, deps)).toMatchObject({
			code: "unsupported",
		});
		expect(
			await publishSkill("acme", "comercial/icp", input, setup().deps),
		).toMatchObject({ code: "not_found" });
	});

	it("un error que no es de la base se propaga", async () => {
		const { deps } = setup({ publishError: new Error("caída") });
		await expect(publishSkill("acme", SLUG, input, deps)).rejects.toThrow(
			"caída",
		);
	});
});

describe("republicar y retirar", () => {
	it("republicar pasa la versión de origen y no exige revisión", async () => {
		const { deps, publish } = setup();
		expect(
			await republishSkill(
				"acme",
				SLUG,
				{ fromVersion: 1, note: "vuelvo" },
				deps,
			),
		).toEqual({ ok: true, version: 2 });
		expect(publish).toHaveBeenCalledWith({
			tenantId: "t1",
			pageId: "p1",
			expectedRevision: null,
			expectedFilesDigest: null,
			note: "vuelvo",
			actorUserId: "admin1",
			fromVersion: 1,
		});
	});

	it("retirar exige administrador y nota", async () => {
		const member = setup({ role: "tenant_member" });
		expect(
			await withdrawSkill("acme", SLUG, { note: "n" }, member.deps),
		).toMatchObject({ code: "forbidden" });
		const admin = setup();
		expect(
			await withdrawSkill("acme", SLUG, { note: "" }, admin.deps),
		).toMatchObject({ code: "validation" });
		expect(
			await withdrawSkill("acme", SLUG, { note: "salió mal" }, admin.deps),
		).toEqual({ ok: true, withdrawn: true });
		expect(admin.withdraw).toHaveBeenCalledWith({
			tenantId: "t1",
			pageId: "p1",
			note: "salió mal",
			actorUserId: "admin1",
		});
	});
});

describe("traducción de rechazos de la base", () => {
	const input = { expectedRevision: 7, expectedFilesDigest: "fd7", note: "n" };
	const rejected = (code: string, details: string) =>
		setup({ publishError: new WikiStoreError(code, "X", details) }).deps;

	it("BR422 se traduce a castellano, sin tokens crudos", async () => {
		const cases: Array<[string, RegExp]> = [
			["description", /descripción/],
			["note", /nota/],
			["package_limit", /paquete/],
			["token_raro", /no cumple/],
		];
		for (const [token, pattern] of cases) {
			const result = await publishSkill(
				"acme",
				SLUG,
				input,
				rejected("BR422", token),
			);
			expect(result).toMatchObject({ ok: false, code: "validation" });
			if (result.ok) throw new Error("debía fallar");
			expect(result.message).toMatch(pattern);
			expect(result.message).not.toContain(token);
		}
	});

	it("BR404 version al republicar", async () => {
		const result = await republishSkill(
			"acme",
			SLUG,
			{ fromVersion: 99, note: "n" },
			rejected("BR404", "version"),
		);
		expect(result).toMatchObject({ ok: false, code: "not_found" });
		expect(result.ok === false && result.message).toMatch(/versión/);
	});

	it("BR409 revision es conflicto", async () => {
		expect(
			await publishSkill("acme", SLUG, input, rejected("BR409", "revision")),
		).toMatchObject({ ok: false, code: "conflict" });
	});
});

describe("más casos de permisos y retiro", () => {
	it("retirar dos veces: la segunda no retira nada", async () => {
		const { deps } = setup();
		deps.store.withdraw = vi.fn(async () => false);
		expect(await withdrawSkill("acme", SLUG, { note: "n" }, deps)).toEqual({
			ok: true,
			withdrawn: false,
		});
	});

	it("un miembro no previsualiza ni republica", async () => {
		const { deps, publish } = setup({ role: "tenant_member" });
		expect(await previewPublish("acme", SLUG, deps)).toMatchObject({
			ok: false,
			code: "forbidden",
		});
		expect(
			await republishSkill("acme", SLUG, { fromVersion: 1, note: "n" }, deps),
		).toMatchObject({ ok: false, code: "forbidden" });
		expect(publish).not.toHaveBeenCalled();
	});
});

describe("tope de skills del plan", () => {
	it("free con 5 publicadas y una sexta en borrador: límite, sin publicar", async () => {
		const { deps, publish } = setup({
			plan: FREE,
			row: DRAFT_ROW,
			othersPublished: 5,
		});
		const result = await publishSkill("acme", SLUG, PUBLISH_INPUT, deps);
		expect(result).toMatchObject({
			ok: false,
			code: "limite",
			reason: "limit:skills",
		});
		expect(publish).not.toHaveBeenCalled();
	});

	it("free con 5 publicadas: republicar una ya publicada pasa", async () => {
		// La fila de SLUG es una de las 5.
		const { deps, publish } = setup({ plan: FREE, othersPublished: 4 });
		const result = await republishSkill(
			"acme",
			SLUG,
			{ fromVersion: 1, note: "n" },
			deps,
		);
		expect(result).toEqual({ ok: true, version: 2 });
		expect(publish).toHaveBeenCalled();
	});

	it("free con 5 publicadas: publicar una versión nueva de una ya publicada pasa", async () => {
		const { deps } = setup({ plan: FREE, othersPublished: 4 });
		const result = await publishSkill("acme", SLUG, PUBLISH_INPUT, deps);
		expect(result).toEqual({ ok: true, version: 2 });
	});

	it("free con 4 publicadas: la quinta pasa", async () => {
		const { deps } = setup({
			plan: FREE,
			row: DRAFT_ROW,
			othersPublished: 4,
		});
		expect(await publishSkill("acme", SLUG, PUBLISH_INPUT, deps)).toEqual({
			ok: true,
			version: 2,
		});
	});

	it("una skill retirada que se vuelve a publicar cuenta como nueva", async () => {
		const { deps, publish } = setup({
			plan: FREE,
			othersPublished: 5,
			row: {
				...DRAFT_ROW,
				current: { ...PUBLISHED_CURRENT, action: "retirar" },
			},
		});
		const result = await republishSkill(
			"acme",
			SLUG,
			{ fromVersion: 1, note: "n" },
			deps,
		);
		expect(result).toMatchObject({ ok: false, code: "limite" });
		expect(publish).not.toHaveBeenCalled();
	});

	it("el plan pago no tiene tope", async () => {
		const { deps } = setup({
			plan: PAGO,
			row: DRAFT_ROW,
			othersPublished: 40,
		});
		expect(await publishSkill("acme", SLUG, PUBLISH_INPUT, deps)).toMatchObject(
			{ ok: true },
		);
	});

	it("sin fila de plan se permite", async () => {
		const { deps } = setup({
			plan: null,
			row: DRAFT_ROW,
			othersPublished: 9,
		});
		expect(await publishSkill("acme", SLUG, PUBLISH_INPUT, deps)).toMatchObject(
			{ ok: true },
		);
	});

	it("una empresa suspendida no republica ni siquiera una ya publicada", async () => {
		const { deps, publish } = setup({
			plan: planOf({ suspendedReason: "trial_vencido" }),
		});
		const result = await republishSkill(
			"acme",
			SLUG,
			{ fromVersion: 1, note: "n" },
			deps,
		);
		expect(result).toMatchObject({
			ok: false,
			code: "limite",
			reason: "suspended:trial_vencido",
		});
		expect(publish).not.toHaveBeenCalled();
	});

	it("si el plan no se puede leer, se deja publicar y se registra", async () => {
		// Disponibilidad antes que rigor: el trigger de la base sigue protegiendo
		// a las empresas suspendidas.
		const spy = vi.spyOn(console, "error").mockImplementation(() => {});
		const { deps, publish } = setup({
			plan: "throws",
			row: DRAFT_ROW,
			othersPublished: 5,
		});
		const result = await publishSkill("acme", SLUG, PUBLISH_INPUT, deps);
		expect(result).toMatchObject({ ok: true });
		expect(publish).toHaveBeenCalled();
		expect(spy).toHaveBeenCalled();
		spy.mockRestore();
	});
});
