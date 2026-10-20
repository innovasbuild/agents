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
import { BrainConflict, BrainError, BrainNotFound } from "../errors.ts";
import { type BrainPage, MAX_SLUG_LENGTH } from "../types.ts";
import { MAX_READABLE_BYTES } from "./catalog.ts";
import {
	type FilesDeps,
	type ParsedSkillMd,
	parseSkillMd,
	putSkillFile,
	readSkillFile,
} from "./files.ts";
import { looksLikeText } from "./http.ts";
import {
	isSkillSlug,
	isValidFilePath,
	isValidSkillFolder,
	isValidSkillName,
	MAX_COMPATIBILITY,
	MAX_DESCRIPTION,
	normalizeSkillFolder,
	SKILLS_PREFIX,
	skillName,
} from "./package.ts";
import type { SkillActor, SkillFailure } from "./publish.ts";
import { renderSkillMd, skillMdKeys, skillMdName } from "./skill-md.ts";
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
	/** Carpetas (relativas a skills/) donde la persona puede crear; "" es directo bajo skills/. */
	creatableFolders?: string[];
}

export interface SkillDrafts {
	/** Dónde puede crear skills esta persona, para decírselo al asistente. */
	creatableFolders?: string[];
	read(input: {
		skill: string;
		path?: string;
	}): Promise<Record<string, unknown>>;
	edit(input: {
		skill: string;
		path?: string;
		old: string;
		new: string;
		reason: string;
	}): Promise<DraftChange>;
	writeFile(input: {
		skill: string;
		path: string;
		content: string;
	}): Promise<DraftChange>;
	create(input: {
		name: string;
		folder?: string;
		title?: string;
		description: string;
		instructions: string;
		compatibility?: string;
		reason: string;
	}): Promise<DraftChange>;
}

export const SKILL_MD = "SKILL.md";

// Los campos del encabezado que se guardan: el resto se perdería en silencio.
const HEADER_KEYS = ["name", "description", "license", "compatibility"];

const decoder = new TextDecoder();
const encoder = new TextEncoder();

// Igual que MCP_MAX_UPSERT_BODY_BYTES de server.ts.
export const MAX_DRAFT_BODY_BYTES = 102_400;

export const DRAFT_NOTE =
	"El cambio quedó en el borrador: todavía no lo ven los demás. Un administrador lo publica desde la plataforma.";

const invalid = (message: string) => new BrainError("validation", message);

function occurrences(text: string, fragment: string): number {
	let count = 0;
	for (
		let at = text.indexOf(fragment);
		at !== -1;
		at = text.indexOf(fragment, at + fragment.length)
	) {
		count += 1;
	}
	return count;
}

// Sin String.replace: un "$&" en el texto nuevo se escribe tal cual.
function replaceOnce(text: string, old: string, replacement: string): string {
	const at = text.indexOf(old);
	return text.slice(0, at) + replacement + text.slice(at + old.length);
}

// El fragmento tiene que aparecer exactamente una vez.
function applyEdit(
	text: string,
	old: string,
	replacement: string,
	where: string,
): string {
	if (old.length === 0) throw invalid("old no puede estar vacío.");
	const count = occurrences(text, old);
	if (count === 0) {
		throw invalid(
			`El fragmento no aparece en ${where}. Leelo con skill_draft_read y copiá el texto exacto.`,
		);
	}
	if (count > 1) {
		throw invalid(
			`El fragmento aparece ${count} veces en ${where}. Sumá texto alrededor para que sea único.`,
		);
	}
	return replaceOnce(text, old, replacement);
}

function checkedSkillMd(
	text: string,
	slug: string,
	descriptionBefore: string,
): ParsedSkillMd {
	const parsed = parseSkillMd(text);
	if (!parsed) {
		throw invalid(
			"El SKILL.md quedó sin un encabezado YAML válido (entre dos líneas ---).",
		);
	}
	const unsupported = (skillMdKeys(text) ?? []).filter(
		(key) => !HEADER_KEYS.includes(key),
	);
	if (unsupported.length > 0) {
		throw invalid(
			`El encabezado tiene ${unsupported.length === 1 ? "un campo" : "campos"} que no se guarda${unsupported.length === 1 ? "" : "n"}: ${unsupported.join(", ")}. Solo se admiten ${HEADER_KEYS.join(", ")}.`,
		);
	}
	if (skillMdName(text) !== skillName(slug)) {
		throw invalid(
			"El campo name del encabezado es la ruta de la skill y no se cambia.",
		);
	}
	if (parsed.description.length > MAX_DESCRIPTION) {
		throw invalid("La description supera los 1024 caracteres.");
	}
	if (parsed.description.length === 0 && descriptionBefore.length > 0) {
		throw invalid(
			"No se puede dejar la skill sin description: el asistente la usa para saber cuándo cargarla.",
		);
	}
	if (parsed.compatibility.length > MAX_COMPATIBILITY) {
		throw invalid("El campo compatibility supera los 500 caracteres.");
	}
	if (encoder.encode(parsed.body).length > MAX_DRAFT_BODY_BYTES) {
		throw invalid("El cuerpo del SKILL.md supera los 100 KB.");
	}
	return parsed;
}

function translateSave(error: unknown, slug: string): unknown {
	if (error instanceof BrainConflict) {
		return new BrainError(
			"conflict",
			"Alguien guardó la skill mientras la editabas. Leela de nuevo con skill_draft_read y repetí el cambio.",
		);
	}
	if (error instanceof BrainNotFound) return notFound(slug);
	return error;
}

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

// Las carpetas (relativas a skills/) donde esta persona puede crear una skill:
// "" es directo bajo skills/. Quien edita todo skills/ (un administrador de la
// empresa, o un editor general) no necesita listarlas. Quien solo tiene reglas
// sobre carpetas puntuales tiene que pasar `folder`, y el asistente no puede
// adivinar cuál: por eso se le dice. `min` es el nivel que hace falta: subir un
// zip pide administrador (spec 24.6 D4).
export function creatableSkillFolders(
	rules: AccessRule[],
	principal: Principal,
	min: Level = "editor",
): string[] {
	const edits = (path: string) =>
		atLeast(resolveAccess(rules, principal, path), min);
	if (edits(`${SKILLS_PREFIX}x`)) return [""];
	const found = new Set<string>();
	for (const rule of rules) {
		if (rule.path.startsWith(SKILLS_PREFIX) && edits(rule.path)) {
			found.add(rule.path.slice(SKILLS_PREFIX.length));
		}
	}
	// Una carpeta dentro de otra ya incluida no suma.
	return [...found]
		.filter(
			(folder) =>
				![...found].some(
					(other) => other !== folder && folder.startsWith(`${other}/`),
				),
		)
		.sort();
}

function forbiddenCreate(folders: string[] | undefined): string {
	const base = "Necesitás ser editor de esa carpeta para crear una skill ahí.";
	const named = (folders ?? []).filter((folder) => folder !== "");
	if (folders && folders.length === 0) {
		return `${base} No tenés carpetas donde crear skills nuevas; sí podés editar las que ya administrás.`;
	}
	if (named.length === 0) return base;
	return `${base} Podés crear en: ${named.join(", ")} (pasá una en folder, sin el prefijo skills/).`;
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

	// El estado se vuelve a leer: el guardado cambió la revisión o los archivos.
	async function changed(
		actor: SkillActor,
		row: SkillOverviewRow,
		path: string,
		revision?: number,
	): Promise<DraftChange> {
		const fresh = (await files.store.overview(actor.tenantId)).find(
			(item) => item.slug === row.slug,
		);
		return {
			slug: row.slug,
			name: skillName(row.slug),
			path,
			...(revision !== undefined ? { revision } : {}),
			state: draftState(fresh ?? row),
			reviewUrl: deps.reviewUrl(row.slug),
			message: DRAFT_NOTE,
		};
	}

	return {
		creatableFolders: deps.creatableFolders,
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
		async edit({ skill, path, old, new: replacement, reason }) {
			const { actor, row } = await resolve(skill);

			if (path === undefined || path === "" || path === SKILL_MD) {
				const page = await draftPage(actor, row.slug);
				const previous = page.frontmatter.description;
				const before = typeof previous === "string" ? previous.trim() : "";
				const text = applyEdit(
					skillMdOf(row.slug, page),
					old,
					replacement,
					"el SKILL.md del borrador",
				);
				const parsed = checkedSkillMd(text, row.slug, before);
				const frontmatter: Record<string, unknown> = {
					...page.frontmatter,
					description: parsed.description,
				};
				for (const key of ["compatibility", "license"] as const) {
					if (parsed[key]) frontmatter[key] = parsed[key];
					else delete frontmatter[key];
				}
				let saved: { revision: number };
				try {
					saved = await files.save(actor, {
						slug: row.slug,
						title: page.title,
						category: page.category,
						status: page.status,
						tags: page.tags,
						frontmatter,
						body: parsed.body,
						reason: `Edición por MCP: ${reason}`,
						baseRevision: page.revision,
					});
				} catch (error) {
					throw translateSave(error, row.slug);
				}
				return changed(actor, row, SKILL_MD, saved.revision);
			}

			if (!isValidFilePath(path)) throw invalid("Ruta de archivo inválida.");
			const read = await readSkillFile(tenantSlug, row.slug, { path }, files);
			if (!read.ok) failure(read);
			if (
				read.bytes.length > MAX_READABLE_BYTES ||
				!looksLikeText(read.bytes)
			) {
				throw invalid(
					`"${path}" no es un archivo de texto de hasta 256 KB: se edita desde la plataforma.`,
				);
			}
			const next = encoder.encode(
				applyEdit(decoder.decode(read.bytes), old, replacement, `"${path}"`),
			);
			if (next.length > MAX_READABLE_BYTES) {
				throw invalid(`"${path}" quedaría de más de 256 KB.`);
			}
			const put = await putSkillFile(
				tenantSlug,
				row.slug,
				{ path, bytes: next },
				files,
			);
			if (!put.ok) failure(put);
			return changed(actor, row, path);
		},

		async writeFile({ skill, path, content }) {
			const { actor, row } = await resolve(skill);
			if (path === SKILL_MD) {
				throw invalid(
					"SKILL.md no es un archivo del paquete: cambialo con skill_draft_edit.",
				);
			}
			if (!isValidFilePath(path)) {
				throw invalid(
					"Ruta inválida. Usá letras, números, guiones y puntos, sin espacios ni «..», hasta seis niveles.",
				);
			}
			const bytes = encoder.encode(content);
			if (bytes.length > MAX_READABLE_BYTES) {
				throw invalid(
					"Por acá entran archivos de texto de hasta 256 KB; los más grandes se suben desde la plataforma.",
				);
			}
			const put = await putSkillFile(
				tenantSlug,
				row.slug,
				{ path, bytes },
				files,
			);
			if (!put.ok) failure(put);
			return changed(actor, row, path);
		},

		async create(input) {
			const actor = await files.actor(tenantSlug);
			if (!actor) throw notFound(input.name);
			const name = input.name.trim();
			const folder = normalizeSkillFolder(input.folder);
			const slug = folder
				? `${SKILLS_PREFIX}${folder}/${name}`
				: `${SKILLS_PREFIX}${name}`;
			if (
				!isValidSkillName(name) ||
				!isValidSkillFolder(folder) ||
				slug.length > MAX_SLUG_LENGTH
			) {
				throw invalid(
					"El nombre y la carpeta usan minúsculas, dígitos y guiones (la carpeta puede tener subniveles separados por /). El nombre llega a 64 caracteres.",
				);
			}
			const description = input.description.trim();
			if (description.length === 0 || description.length > MAX_DESCRIPTION) {
				throw invalid(
					"La description es obligatoria y llega a 1024 caracteres: dice cuándo conviene usar la skill.",
				);
			}
			const compatibility = input.compatibility?.trim() ?? "";
			if (compatibility.length > MAX_COMPATIBILITY) {
				throw invalid("El campo compatibility supera los 500 caracteres.");
			}
			if (
				input.instructions.trim().length === 0 ||
				encoder.encode(input.instructions).length > MAX_DRAFT_BODY_BYTES
			) {
				throw invalid("Las instrucciones son obligatorias y llegan a 100 KB.");
			}
			if (!atLeast(deps.levelOf(slug), "editor")) {
				throw new BrainError(
					"forbidden",
					forbiddenCreate(deps.creatableFolders),
				);
			}
			let saved: { revision: number };
			try {
				saved = await files.save(actor, {
					slug,
					title: input.title?.trim() || name,
					category: "skill",
					status: "activo",
					tags: [],
					frontmatter: {
						description,
						...(compatibility ? { compatibility } : {}),
					},
					body: input.instructions,
					reason: `Alta por MCP: ${input.reason}`,
				});
			} catch (error) {
				if (error instanceof BrainConflict) {
					throw new BrainError(
						"conflict",
						`Ya existe una página en ${slug}. Para cambiarla usá skill_draft_edit.`,
					);
				}
				throw error;
			}
			return {
				slug,
				name,
				path: SKILL_MD,
				revision: saved.revision,
				state: "sin_publicar",
				reviewUrl: deps.reviewUrl(slug),
				message: DRAFT_NOTE,
			};
		},
	};
}
