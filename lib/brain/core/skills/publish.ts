// Publicación de skills (spec etapa 24.1 §8). Sin Next ni Supabase: recibe sus
// dependencias, como deletePage. Publica solo un administrador de la empresa;
// el rol se mira antes que nada, así la respuesta a un miembro no depende de
// que la skill exista.
import { isAdminRole } from "../access/types.ts";
import type { BrainPage, BrainRevision, BrainRole } from "../types.ts";
import { WikiStoreError } from "../wiki-store.ts";
import {
	checkPublishable,
	isSkillSlug,
	PUBLISH_MESSAGES,
	type PublishProblem,
	type PublishWarning,
	type SkillFile,
	skillName,
} from "./package.ts";
import { type SkillState, skillState } from "./state.ts";
import type { SkillOverviewRow, SkillStore } from "./store.ts";

export interface SkillActor {
	tenantId: string;
	userId: string;
	role: BrainRole;
}

export interface PublishDeps {
	actor(tenantSlug: string): Promise<SkillActor | null>;
	binding(tenantId: string): Promise<{ provider: "wiki" | "mcp" } | null>;
	// La página sin envolver con permisos ni con withSkillView: el borrador real.
	page(tenantId: string, slug: string): Promise<BrainPage | null>;
	revisions(tenantId: string, slug: string): Promise<BrainRevision[]>;
	store: SkillStore;
}

export type SkillFailure = {
	ok: false;
	code:
		| "not_found"
		| "forbidden"
		| "conflict"
		| "validation"
		| "unsupported"
		| "name_taken";
	message: string;
};

export interface PublishPreview {
	slug: string;
	name: string;
	title: string;
	revision: number;
	filesDigest: string;
	state: SkillState;
	problems: PublishProblem[];
	warnings: PublishWarning[];
	body: string;
	previousBody: string | null;
	description: string;
	previousDescription: string | null;
	files: { added: SkillFile[]; changed: SkillFile[]; removed: SkillFile[] };
	editorIds: string[];
}

export const skillFail = (
	code: SkillFailure["code"],
	message: string,
): SkillFailure => ({ ok: false, code, message });

const NOT_FOUND = "No encontrado.";
const MAX_NOTE = 500;

type Authorized = { ok: true; actor: SkillActor; row: SkillOverviewRow };

async function authorize(
	tenantSlug: string,
	slug: string,
	deps: PublishDeps,
): Promise<Authorized | SkillFailure> {
	if (!isSkillSlug(slug)) return skillFail("not_found", NOT_FOUND);
	const actor = await deps.actor(tenantSlug);
	if (!actor) return skillFail("not_found", NOT_FOUND);
	if (!isAdminRole(actor.role)) {
		return skillFail(
			"forbidden",
			"Solo un administrador de la empresa publica o retira skills.",
		);
	}
	const binding = await deps.binding(actor.tenantId);
	if (!binding) return skillFail("not_found", NOT_FOUND);
	if (binding.provider !== "wiki") {
		return skillFail(
			"unsupported",
			"Este brain es externo: las skills se publican en su origen.",
		);
	}
	const row = (await deps.store.overview(actor.tenantId)).find(
		(item) => item.slug === slug,
	);
	if (!row) return skillFail("not_found", NOT_FOUND);
	return { ok: true, actor, row };
}

function cleanNote(note: string): string | null {
	const trimmed = note.trim();
	return trimmed.length > 0 && trimmed.length <= MAX_NOTE ? trimmed : null;
}

const NOTE_REQUIRED = "Escribí una nota de hasta 500 caracteres.";

// Traduce los rechazos de las funciones SQL. Lo demás se propaga.
function storeFailure(error: unknown, slug: string): SkillFailure {
	if (!(error instanceof WikiStoreError)) throw error;
	if (error.code === "BR409") {
		return error.details === "name"
			? skillFail(
					"name_taken",
					`Ya hay otra skill publicada con el nombre «${skillName(slug)}». Retirá esa o usá otra ruta para esta.`,
				)
			: skillFail(
					"conflict",
					"El borrador cambió mientras revisabas. Volvé a abrir la revisión.",
				);
	}
	if (error.code === "BR422") {
		return skillFail("validation", `Datos inválidos en: ${error.details}.`);
	}
	if (error.code === "BR404") return skillFail("not_found", NOT_FOUND);
	throw error;
}

function compareFiles(previous: SkillFile[], current: SkillFile[]) {
	const before = new Map(previous.map((item) => [item.path, item]));
	const now = new Set(current.map((item) => item.path));
	return {
		added: current.filter((item) => !before.has(item.path)),
		changed: current.filter((item) => {
			const old = before.get(item.path);
			return old !== undefined && old.sha256 !== item.sha256;
		}),
		removed: previous.filter((item) => !now.has(item.path)),
	};
}

export async function previewPublish(
	tenantSlug: string,
	slug: string,
	deps: PublishDeps,
): Promise<{ ok: true; preview: PublishPreview } | SkillFailure> {
	const auth = await authorize(tenantSlug, slug, deps);
	if (!auth.ok) return auth;
	const { actor, row } = auth;

	const page = await deps.page(actor.tenantId, slug);
	if (!page) return skillFail("not_found", NOT_FOUND);
	const [files, acts, revisions] = await Promise.all([
		deps.store.files(actor.tenantId, row.pageId),
		deps.store.acts(actor.tenantId, row.pageId),
		deps.revisions(actor.tenantId, slug),
	]);
	// La última publicación, aunque después se haya retirado.
	const previous = acts.find((act) => act.action === "publicar") ?? null;
	const check = checkPublishable({
		slug,
		frontmatter: page.frontmatter,
		body: page.body,
		files,
	});
	const since = previous?.pageRevision ?? 0;

	return {
		ok: true,
		preview: {
			slug,
			name: skillName(slug),
			title: page.title,
			revision: page.revision,
			filesDigest: row.draftFilesDigest,
			state: skillState(row),
			problems: check.problems,
			warnings: check.warnings,
			body: page.body,
			previousBody: previous?.body ?? null,
			description:
				typeof page.frontmatter.description === "string"
					? page.frontmatter.description
					: "",
			previousDescription: previous?.description ?? null,
			files: compareFiles(previous?.manifest ?? [], files),
			editorIds: [
				...new Set(
					revisions
						.filter((rev) => rev.revision > since && rev.authorUserId !== null)
						.map((rev) => rev.authorUserId as string),
				),
			],
		},
	};
}

export async function publishSkill(
	tenantSlug: string,
	slug: string,
	input: {
		expectedRevision: number;
		expectedFilesDigest: string;
		note: string;
	},
	deps: PublishDeps,
): Promise<{ ok: true; version: number } | SkillFailure> {
	const auth = await authorize(tenantSlug, slug, deps);
	if (!auth.ok) return auth;
	const { actor, row } = auth;
	const note = cleanNote(input.note);
	if (!note) return skillFail("validation", NOTE_REQUIRED);

	const page = await deps.page(actor.tenantId, slug);
	if (!page) return skillFail("not_found", NOT_FOUND);
	const files = await deps.store.files(actor.tenantId, row.pageId);
	const { problems } = checkPublishable({
		slug,
		frontmatter: page.frontmatter,
		body: page.body,
		files,
	});
	if (problems.length > 0) {
		return skillFail(
			"validation",
			problems.map((problem) => PUBLISH_MESSAGES[problem]).join(" "),
		);
	}

	try {
		const out = await deps.store.publish({
			tenantId: actor.tenantId,
			pageId: row.pageId,
			expectedRevision: input.expectedRevision,
			expectedFilesDigest: input.expectedFilesDigest,
			note,
			actorUserId: actor.userId,
			fromVersion: null,
		});
		return { ok: true, version: out.version };
	} catch (error) {
		return storeFailure(error, slug);
	}
}

export async function republishSkill(
	tenantSlug: string,
	slug: string,
	input: { fromVersion: number; note: string },
	deps: PublishDeps,
): Promise<{ ok: true; version: number } | SkillFailure> {
	const auth = await authorize(tenantSlug, slug, deps);
	if (!auth.ok) return auth;
	const note = cleanNote(input.note);
	if (!note) return skillFail("validation", NOTE_REQUIRED);

	try {
		const out = await deps.store.publish({
			tenantId: auth.actor.tenantId,
			pageId: auth.row.pageId,
			expectedRevision: null,
			expectedFilesDigest: null,
			note,
			actorUserId: auth.actor.userId,
			fromVersion: input.fromVersion,
		});
		return { ok: true, version: out.version };
	} catch (error) {
		return storeFailure(error, slug);
	}
}

export async function withdrawSkill(
	tenantSlug: string,
	slug: string,
	input: { note: string },
	deps: PublishDeps,
): Promise<{ ok: true; withdrawn: boolean } | SkillFailure> {
	const auth = await authorize(tenantSlug, slug, deps);
	if (!auth.ok) return auth;
	const note = cleanNote(input.note);
	if (!note) return skillFail("validation", NOTE_REQUIRED);

	try {
		const withdrawn = await deps.store.withdraw({
			tenantId: auth.actor.tenantId,
			pageId: auth.row.pageId,
			note,
			actorUserId: auth.actor.userId,
		});
		return { ok: true, withdrawn };
	} catch (error) {
		return storeFailure(error, slug);
	}
}
