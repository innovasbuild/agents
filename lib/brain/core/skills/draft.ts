// Crear y editar skills desde un asistente (spec etapa 24.5). Puro: recibe sus
// dependencias. El permiso de editor, el hash y los topes de archivos los
// decide files.ts; acá se resuelve la skill, se arma el texto y se valida.
// Todo cambio va al borrador: publicar y retirar son de la web (24.1 S5). Una
// skill que la persona no puede editar responde igual que una inexistente.
import { resolveAccess } from "../access/resolve-access.ts";
import {
	type AccessRule,
	atLeast,
	type Level,
	type Principal,
} from "../access/types.ts";
import { BrainError } from "../errors.ts";
import type { BrainPage } from "../types.ts";
import { MAX_READABLE_BYTES } from "./catalog.ts";
import { type FilesDeps, readSkillFile } from "./files.ts";
import { looksLikeText } from "./http.ts";
import { isSkillSlug, SKILLS_PREFIX, skillName } from "./package.ts";
import type { SkillActor, SkillFailure } from "./publish.ts";
import { renderSkillMd } from "./skill-md.ts";
import { skillState } from "./state.ts";
import type { SkillOverviewRow } from "./store.ts";

export type DraftState = "sin_publicar" | "con_cambios" | "al_dia" | "retirada";

export interface DraftChange {
	slug: string;
	name: string;
	path: string;
	revision?: number;
	state: DraftState;
	reviewUrl: string;
	message: string;
}

export interface SkillDraftDeps {
	tenantSlug: string;
	/** Las dependencias de files.ts ya armadas con la persona del pedido. */
	files: FilesDeps;
	levelOf(path: string): Level | null;
	reviewUrl(slug: string): string;
}

export interface SkillDrafts {
	read(input: {
		skill: string;
		path?: string;
	}): Promise<Record<string, unknown>>;
}

export const SKILL_MD = "SKILL.md";

const decoder = new TextDecoder();

export const notFound = (skill: string) =>
	new BrainError(
		"not_found",
		`No existe la skill "${skill}" entre las que podés editar.`,
	);

export function failure(result: SkillFailure): never {
	const code =
		result.code === "not_found" ||
		result.code === "forbidden" ||
		result.code === "conflict"
			? result.code
			: "validation";
	throw new BrainError(code, result.message);
}

function draftState(row: SkillOverviewRow): DraftState {
	const state = skillState(row);
	if (state.kind === "publicada") return state.dirty ? "con_cambios" : "al_dia";
	return state.kind;
}

export function skillMdOf(slug: string, page: BrainPage): string {
	const description = page.frontmatter.description;
	return renderSkillMd({
		name: skillName(slug),
		description: typeof description === "string" ? description : "",
		frontmatter: page.frontmatter,
		body: page.body,
	});
}

// ¿Alguna tool de edición le sirve a esta persona? Un administrador, un editor
// general, el editor de alguna skill o de alguna carpeta bajo skills/.
export function canEditSkills(
	rules: AccessRule[],
	principal: Principal,
	rows: SkillOverviewRow[],
): boolean {
	const edits = (path: string) =>
		atLeast(resolveAccess(rules, principal, path), "editor");
	if (edits(`${SKILLS_PREFIX}x`)) return true;
	if (rows.some((row) => edits(row.slug))) return true;
	return rules.some(
		(rule) => rule.path.startsWith(SKILLS_PREFIX) && edits(rule.path),
	);
}

export function createSkillDrafts(deps: SkillDraftDeps): SkillDrafts {
	const { files, tenantSlug } = deps;

	// La skill editable que nombra la persona. Lo que no puede editar responde
	// not_found, igual que lo que no existe.
	async function resolve(skill: string) {
		const actor = await files.actor(tenantSlug);
		if (!actor) throw notFound(skill);
		const rows = await files.store.overview(actor.tenantId);
		const editable = rows.filter(
			(row) =>
				isSkillSlug(row.slug) && atLeast(deps.levelOf(row.slug), "editor"),
		);
		const exact = editable.find((row) => row.slug === skill);
		const byName = editable.filter((row) => skillName(row.slug) === skill);
		if (!exact && byName.length > 1) {
			throw new BrainError(
				"validation",
				`Hay más de una skill que podés editar llamada "${skill}": ${byName.map((row) => row.slug).join(", ")}. Usá la ruta completa.`,
			);
		}
		const row = exact ?? byName[0];
		if (!row) throw notFound(skill);
		return { actor, row };
	}

	async function draftPage(actor: SkillActor, slug: string) {
		const page = await files.page(actor.tenantId, slug);
		if (!page) throw notFound(slug);
		return page;
	}

	return {
		async read({ skill, path }) {
			const { actor, row } = await resolve(skill);
			const base = {
				slug: row.slug,
				name: skillName(row.slug),
				reviewUrl: deps.reviewUrl(row.slug),
			};
			if (path !== undefined && path !== SKILL_MD) {
				const read = await readSkillFile(tenantSlug, row.slug, { path }, files);
				if (!read.ok) failure(read);
				if (read.bytes.length > MAX_READABLE_BYTES) {
					throw new BrainError(
						"validation",
						`"${path}" pesa más de 256 KB y no se lee desde acá: está en la plataforma.`,
					);
				}
				if (!looksLikeText(read.bytes)) {
					throw new BrainError(
						"validation",
						`"${path}" no es un archivo de texto y no se lee desde acá: está en la plataforma.`,
					);
				}
				return {
					...base,
					path,
					size: read.bytes.length,
					content: decoder.decode(read.bytes),
				};
			}
			const page = await draftPage(actor, row.slug);
			const manifest = await files.store.files(actor.tenantId, row.pageId);
			const state = skillState(row);
			return {
				...base,
				revision: page.revision,
				state: draftState(row),
				publishedVersion: state.kind === "publicada" ? state.version : null,
				skillMd: skillMdOf(row.slug, page),
				files: manifest.map((file) => ({
					path: file.path,
					size: file.size,
					readable: file.size <= MAX_READABLE_BYTES,
				})),
			};
		},
	};
}
