// Archivos de una skill (spec etapa 24.1 §6 y §7). Sin Next ni Supabase:
// recibe sus dependencias. Sube y quita quien es editor de la página; lee el
// borrador quien es editor, y quien solo lee llega a lo que figura en la
// versión vigente. El hash lo calcula siempre el servidor.
import { createHash } from "node:crypto";
import { parse as parseYaml } from "yaml";
import { resolveAccess } from "../access/resolve-access.ts";
import {
	type AccessRulesStore,
	atLeast,
	isAdminRole,
	type Level,
	type Principal,
} from "../access/types.ts";
import {
	BrainConflict,
	BrainForbidden,
	BrainNotFound,
	BrainValidation,
} from "../errors.ts";
import type { BrainPage, BrainWrite } from "../types.ts";
import { WikiStoreError } from "../wiki-store.ts";
import {
	isSkillSlug,
	isValidFilePath,
	MAX_COMPATIBILITY,
	MAX_DESCRIPTION,
	MAX_FILE_BYTES,
	MAX_PACKAGE_BYTES,
	MAX_PACKAGE_FILES,
	type SkillFile,
} from "./package.ts";
import { type SkillActor, type SkillFailure, skillFail } from "./publish.ts";
import { publishedSnapshot } from "./state.ts";
import type { SkillOverviewRow, SkillStore } from "./store.ts";

export interface BlobStore {
	put(tenantId: string, sha256: string, bytes: Uint8Array): Promise<void>;
	get(tenantId: string, sha256: string): Promise<Uint8Array | null>;
}

export interface FilesDeps {
	actor(tenantSlug: string): Promise<SkillActor | null>;
	binding(tenantId: string): Promise<{ provider: "wiki" | "mcp" } | null>;
	rules: AccessRulesStore;
	page(tenantId: string, slug: string): Promise<BrainPage | null>;
	// Guarda el borrador con los permisos de la persona (lanza errores Brain*).
	save(actor: SkillActor, write: BrainWrite): Promise<{ revision: number }>;
	store: SkillStore;
	blobs: BlobStore;
}

export interface PackageEntry {
	path: string;
	bytes: Uint8Array;
}

export interface ParsedSkillMd {
	description: string;
	compatibility: string;
	license: string;
	body: string;
}

const NOT_FOUND = "No encontrado.";
const IMPORT_REASON = "Importación de paquete";

export function sha256Hex(bytes: Uint8Array): string {
	return createHash("sha256").update(bytes).digest("hex");
}

const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;

export function parseSkillMd(text: string): ParsedSkillMd | null {
	const match = FRONTMATTER.exec(text);
	if (!match) return null;
	let data: unknown;
	try {
		data = parseYaml(match[1]);
	} catch {
		return null;
	}
	if (typeof data !== "object" || data === null || Array.isArray(data))
		return null;
	const fields = data as Record<string, unknown>;
	const str = (value: unknown) =>
		typeof value === "string" ? value.trim() : "";
	return {
		description: str(fields.description),
		compatibility: str(fields.compatibility),
		license: str(fields.license),
		body: match[2].replace(/^\r?\n/, ""),
	};
}

// Un zip suele traer el paquete adentro de una carpeta con su nombre.
function stripRoot(entries: PackageEntry[]): PackageEntry[] {
	if (entries.some((entry) => entry.path === "SKILL.md")) return entries;
	const roots = new Set(entries.map((entry) => entry.path.split("/")[0]));
	if (roots.size !== 1 || entries.some((entry) => !entry.path.includes("/")))
		return entries;
	const root = [...roots][0];
	// Solo una carpeta común válida: "..", "." o vacío no se descartan.
	if (!isValidFilePath(root)) return entries;
	const prefix = `${root}/`;
	return entries.map((entry) => ({
		...entry,
		path: entry.path.slice(prefix.length),
	}));
}

export function planImport(
	raw: PackageEntry[],
):
	| { ok: true; skill: ParsedSkillMd; files: PackageEntry[] }
	| { ok: false; problems: string[] } {
	const entries = stripRoot(raw);
	const problems: string[] = [];

	const skillMds = entries.filter((entry) => entry.path === "SKILL.md");
	const skillMd = skillMds[0];
	if (skillMds.length > 1) problems.push("Ruta repetida: SKILL.md");
	const files = entries.filter((entry) => entry.path !== "SKILL.md");
	let skill: ParsedSkillMd | null = null;
	if (!skillMd) {
		problems.push("Falta SKILL.md en la raíz del paquete.");
	} else {
		skill = parseSkillMd(new TextDecoder().decode(skillMd.bytes));
		if (!skill) {
			problems.push("SKILL.md no tiene un encabezado YAML válido.");
		} else if (skill.description.length === 0) {
			problems.push("SKILL.md no trae description.");
		} else if (skill.description.length > MAX_DESCRIPTION) {
			problems.push("La description de SKILL.md supera los 1024 caracteres.");
		} else if (skill.compatibility.length > MAX_COMPATIBILITY) {
			problems.push("El campo compatibility supera los 500 caracteres.");
		}
	}

	const seen = new Set<string>();
	let total = 0;
	for (const entry of files) {
		total += entry.bytes.length;
		if (!isValidFilePath(entry.path)) {
			problems.push(`Ruta inválida: ${entry.path}`);
		} else if (seen.has(entry.path)) {
			problems.push(`Ruta repetida: ${entry.path}`);
		} else if (entry.bytes.length === 0) {
			problems.push(`Archivo vacío: ${entry.path}`);
		} else if (entry.bytes.length > MAX_FILE_BYTES) {
			problems.push(`Supera los 4 MB: ${entry.path}`);
		}
		seen.add(entry.path);
	}
	if (files.length > MAX_PACKAGE_FILES)
		problems.push("El paquete tiene más de 50 archivos.");
	if (total > MAX_PACKAGE_BYTES) problems.push("El paquete pesa más de 20 MB.");

	if (problems.length > 0 || !skill) return { ok: false, problems };
	return { ok: true, skill, files };
}

type Context = {
	ok: true;
	actor: SkillActor;
	level: Level;
	row: SkillOverviewRow;
};

// Quién es, qué nivel tiene sobre la skill y cuál es su fila. Lo que no ve
// responde not_found, igual que lo que no existe.
async function context(
	tenantSlug: string,
	slug: string,
	deps: FilesDeps,
): Promise<Context | SkillFailure> {
	if (!isSkillSlug(slug)) return skillFail("not_found", NOT_FOUND);
	const actor = await deps.actor(tenantSlug);
	if (!actor) return skillFail("not_found", NOT_FOUND);
	const binding = await deps.binding(actor.tenantId);
	if (!binding) return skillFail("not_found", NOT_FOUND);
	if (binding.provider !== "wiki") {
		return skillFail(
			"unsupported",
			"Este brain es externo: las skills se arman en su origen.",
		);
	}
	// Solo un miembro común depende de las reglas. Si no se pueden cargar, esto
	// lanza: falla cerrada.
	const rules = isAdminRole(actor.role)
		? []
		: await deps.rules.load(actor.tenantId);
	const principal: Principal = {
		kind: "user",
		userId: actor.userId,
		role: actor.role,
	};
	const level = resolveAccess(rules, principal, slug);
	if (level === null) return skillFail("not_found", NOT_FOUND);
	const row = (await deps.store.overview(actor.tenantId)).find(
		(item) => item.slug === slug,
	);
	if (!row) return skillFail("not_found", NOT_FOUND);
	return { ok: true, actor, level, row };
}

const MAX_PROBLEMS_SHOWN = 10;

function problemsMessage(problems: string[]): string {
	const shown = problems.slice(0, MAX_PROBLEMS_SHOWN).join(" ");
	const rest = problems.length - MAX_PROBLEMS_SHOWN;
	return rest > 0 ? `${shown} y ${rest} más.` : shown;
}

// Quien solo lee y no ve la skill publicada no puede saber que existe: la
// respuesta es la misma que para una ruta que no existe.
function requireEditor(ctx: Context): SkillFailure | null {
	if (atLeast(ctx.level, "editor")) return null;
	if (!publishedSnapshot(ctx.row)) return skillFail("not_found", NOT_FOUND);
	return skillFail("forbidden", ONLY_EDITORS);
}

const ONLY_EDITORS =
	"Necesitás ser editor de esta skill para cambiar sus archivos.";

function fileProblem(entry: PackageEntry): string | null {
	if (!isValidFilePath(entry.path))
		return "Ruta inválida. Usá letras, números, guiones y puntos, sin espacios ni «..», hasta seis niveles.";
	if (entry.bytes.length === 0) return "El archivo está vacío.";
	if (entry.bytes.length > MAX_FILE_BYTES) return "El archivo supera los 4 MB.";
	return null;
}

function storeFailure(error: unknown): SkillFailure {
	if (!(error instanceof WikiStoreError)) throw error;
	if (error.code === "BR422" && error.details === "package_limit") {
		return skillFail(
			"validation",
			"El paquete no puede pasar de 50 archivos ni de 20 MB.",
		);
	}
	if (error.code === "BR422" || error.code === "23514") {
		return skillFail("validation", "Archivo o ruta inválidos.");
	}
	if (error.code === "BR404") return skillFail("not_found", NOT_FOUND);
	throw error;
}

// Chequeo barato y previo a procesar un pedido pesado (descomprimir un zip):
// quién es y si puede editar esa skill. Responde igual que el resto de las
// operaciones; no cambia nada.
export async function authorizeSkillEdit(
	tenantSlug: string,
	slug: string,
	deps: FilesDeps,
): Promise<{ ok: true } | SkillFailure> {
	const ctx = await context(tenantSlug, slug, deps);
	if (!ctx.ok) return ctx;
	return requireEditor(ctx) ?? { ok: true };
}

export async function putSkillFile(
	tenantSlug: string,
	slug: string,
	input: PackageEntry,
	deps: FilesDeps,
): Promise<{ ok: true; filesDigest: string } | SkillFailure> {
	const ctx = await context(tenantSlug, slug, deps);
	if (!ctx.ok) return ctx;
	const denied = requireEditor(ctx);
	if (denied) return denied;
	const problem = fileProblem(input);
	if (problem) return skillFail("validation", problem);

	const sha256 = sha256Hex(input.bytes);
	// Primero el contenido: una fila nunca apunta a algo que no está guardado.
	await deps.blobs.put(ctx.actor.tenantId, sha256, input.bytes);
	try {
		const filesDigest = await deps.store.putFile({
			tenantId: ctx.actor.tenantId,
			pageId: ctx.row.pageId,
			path: input.path,
			sha256,
			size: input.bytes.length,
			actorUserId: ctx.actor.userId,
		});
		return { ok: true, filesDigest };
	} catch (error) {
		return storeFailure(error);
	}
}

export async function removeSkillFile(
	tenantSlug: string,
	slug: string,
	path: string,
	deps: FilesDeps,
): Promise<{ ok: true; filesDigest: string } | SkillFailure> {
	const ctx = await context(tenantSlug, slug, deps);
	if (!ctx.ok) return ctx;
	const denied = requireEditor(ctx);
	if (denied) return denied;
	try {
		const filesDigest = await deps.store.removeFile({
			tenantId: ctx.actor.tenantId,
			pageId: ctx.row.pageId,
			path,
			actorUserId: ctx.actor.userId,
		});
		return { ok: true, filesDigest };
	} catch (error) {
		return storeFailure(error);
	}
}

export async function readSkillFile(
	tenantSlug: string,
	slug: string,
	input: { path: string; version?: number },
	deps: FilesDeps,
): Promise<{ ok: true; path: string; bytes: Uint8Array } | SkillFailure> {
	const ctx = await context(tenantSlug, slug, deps);
	if (!ctx.ok) return ctx;
	const { actor, row } = ctx;

	// Un lector debe llamar sin `version`: con ella siempre recibe not_found.
	let manifest: SkillFile[];
	if (atLeast(ctx.level, "editor")) {
		manifest =
			input.version === undefined
				? await deps.store.files(actor.tenantId, row.pageId)
				: ((await deps.store.acts(actor.tenantId, row.pageId)).find(
						(act) => act.action === "publicar" && act.version === input.version,
					)?.manifest ?? []);
	} else {
		// Un lector llega solo a la versión vigente: ni borrador ni anteriores.
		manifest =
			input.version === undefined
				? (publishedSnapshot(row)?.manifest ?? [])
				: [];
	}

	const file = manifest.find((item) => item.path === input.path);
	if (!file) return skillFail("not_found", NOT_FOUND);
	const bytes = await deps.blobs.get(actor.tenantId, file.sha256);
	if (!bytes) return skillFail("not_found", NOT_FOUND);
	return { ok: true, path: file.path, bytes };
}

export async function importSkillPackage(
	tenantSlug: string,
	slug: string,
	entries: PackageEntry[],
	deps: FilesDeps,
): Promise<{ ok: true; files: number; revision: number } | SkillFailure> {
	const ctx = await context(tenantSlug, slug, deps);
	if (!ctx.ok) return ctx;
	const denied = requireEditor(ctx);
	if (denied) return denied;
	const { actor, row } = ctx;

	// Todo se valida antes de escribir: un paquete inválido no cambia nada.
	const plan = planImport(entries);
	if (!plan.ok) return skillFail("validation", problemsMessage(plan.problems));

	const page = await deps.page(actor.tenantId, slug);
	if (!page) return skillFail("not_found", NOT_FOUND);

	const frontmatter: Record<string, unknown> = {
		...page.frontmatter,
		description: plan.skill.description,
	};
	for (const key of ["compatibility", "license"] as const) {
		if (plan.skill[key]) frontmatter[key] = plan.skill[key];
		else delete frontmatter[key];
	}

	let revision: number;
	try {
		revision = (
			await deps.save(actor, {
				slug,
				title: page.title,
				category: page.category,
				status: page.status,
				tags: page.tags,
				frontmatter,
				body: plan.skill.body,
				reason: IMPORT_REASON,
				baseRevision: page.revision,
			})
		).revision;
	} catch (error) {
		if (error instanceof BrainConflict) {
			return skillFail(
				"conflict",
				"Alguien guardó el borrador mientras importabas. Recargá y probá de nuevo.",
			);
		}
		if (error instanceof BrainNotFound)
			return skillFail("not_found", NOT_FOUND);
		if (error instanceof BrainForbidden)
			return skillFail("forbidden", ONLY_EDITORS);
		if (error instanceof BrainValidation)
			return skillFail("validation", error.message);
		throw error;
	}

	try {
		const incoming = new Set(plan.files.map((file) => file.path));
		const existing = await deps.store.files(actor.tenantId, row.pageId);
		// Primero se quita lo que el paquete no trae: así el tope de 50 archivos
		// no salta a mitad de camino.
		for (const file of existing) {
			if (incoming.has(file.path)) continue;
			await deps.store.removeFile({
				tenantId: actor.tenantId,
				pageId: row.pageId,
				path: file.path,
				actorUserId: actor.userId,
			});
		}
		// Los que achican van primero: el total nunca pasa del mayor entre el de
		// partida y el final, así no salta el tope de 20 MB a mitad de camino.
		const sizeBefore = new Map(existing.map((file) => [file.path, file.size]));
		const ordered = [...plan.files].sort(
			(a, b) =>
				a.bytes.length -
				(sizeBefore.get(a.path) ?? 0) -
				(b.bytes.length - (sizeBefore.get(b.path) ?? 0)),
		);
		for (const file of ordered) {
			const sha256 = sha256Hex(file.bytes);
			await deps.blobs.put(actor.tenantId, sha256, file.bytes);
			await deps.store.putFile({
				tenantId: actor.tenantId,
				pageId: row.pageId,
				path: file.path,
				sha256,
				size: file.bytes.length,
				actorUserId: actor.userId,
			});
		}
	} catch (error) {
		return storeFailure(error);
	}

	return { ok: true, files: plan.files.length, revision };
}
