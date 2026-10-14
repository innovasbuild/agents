// Crear, describir y borrar carpetas (spec etapa 26 §3.2). Sin Next ni
// Supabase, como delete.ts: el permiso se decide acá con las reglas del tenant.
import { resolveAccess } from "../access/resolve-access.ts";
import {
	type AccessRulesStore,
	isAdminRole,
	type Principal,
	ROOT_PATH,
} from "../access/types.ts";
import {
	MAX_FOLDER_DESCRIPTION,
	parentPath,
	validateFolderPath,
} from "../folders.ts";
import type { FolderWriter } from "../folders-store.ts";
import type { BrainRole } from "../types.ts";
import { WikiStoreError } from "../wiki-store.ts";

export type FolderFailure = {
	ok: false;
	code: "invalid" | "not_found" | "forbidden" | "conflict" | "unsupported";
	message: string;
};
type FolderResult = { ok: true } | FolderFailure;

export interface FolderDeps {
	actor(
		tenantSlug: string,
	): Promise<{ tenantId: string; userId: string; role: BrainRole } | null>;
	rules: AccessRulesStore;
	binding(
		tenantId: string,
	): Promise<{ id: string; provider: "wiki" | "mcp" } | null>;
	writer: FolderWriter;
}

const fail = (code: FolderFailure["code"], message: string): FolderFailure => ({
	ok: false,
	code,
	message,
});
const NOT_FOUND = "No encontrado.";

const MESSAGES: Record<string, FolderFailure> = {
	folder_exists: fail("conflict", "Ya existe una carpeta con ese nombre."),
	folder_not_empty: fail(
		"conflict",
		"La carpeta no está vacía: mové o borrá lo que tiene adentro antes de borrarla.",
	),
	folder_last: fail(
		"conflict",
		"El brain necesita al menos una carpeta de primer nivel.",
	),
	parent: fail("not_found", "La carpeta de arriba ya no existe."),
	folder: fail("not_found", NOT_FOUND),
	too_many: fail(
		"invalid",
		"El brain admite hasta 20 carpetas de primer nivel.",
	),
	reserved_path: fail("invalid", "Ese nombre está reservado por el brain."),
	path: fail("invalid", "El nombre de la carpeta no es válido."),
};

// Quién es y si administra `target`. Lo que no ve responde not_found.
async function authorize(
	tenantSlug: string,
	target: string,
	deps: FolderDeps,
): Promise<{ ok: true; tenantId: string; userId: string } | FolderFailure> {
	const actor = await deps.actor(tenantSlug);
	if (!actor) return fail("not_found", NOT_FOUND);
	const binding = await deps.binding(actor.tenantId);
	if (!binding) return fail("not_found", NOT_FOUND);
	if (binding.provider !== "wiki")
		return fail(
			"unsupported",
			"Este brain es externo: sus carpetas se manejan en su origen.",
		);

	const rules = isAdminRole(actor.role)
		? []
		: await deps.rules.load(actor.tenantId);
	const principal: Principal = {
		kind: "user",
		userId: actor.userId,
		role: actor.role,
	};
	const level = resolveAccess(rules, principal, target);
	if (level === null) return fail("not_found", NOT_FOUND);
	if (level !== "administrador")
		return fail(
			"forbidden",
			"Solo un administrador de esta carpeta puede hacerlo.",
		);
	return { ok: true, tenantId: actor.tenantId, userId: actor.userId };
}

async function run(write: () => Promise<void>): Promise<FolderResult> {
	try {
		await write();
		return { ok: true };
	} catch (error) {
		if (
			error instanceof WikiStoreError &&
			Object.hasOwn(MESSAGES, error.details)
		)
			return MESSAGES[error.details];
		throw error;
	}
}

function checkInput(path: string, description: string): FolderFailure | null {
	const valid = validateFolderPath(path);
	if (!valid.ok) return fail("invalid", valid.message);
	if (description.length > MAX_FOLDER_DESCRIPTION)
		return fail(
			"invalid",
			`La descripción tiene hasta ${MAX_FOLDER_DESCRIPTION} caracteres.`,
		);
	return null;
}

export async function createFolder(
	tenantSlug: string,
	path: string,
	description: string,
	deps: FolderDeps,
): Promise<FolderResult> {
	const bad = checkInput(path, description);
	if (bad) return bad;
	// Crear algo de primer nivel es administrar la raíz.
	const auth = await authorize(tenantSlug, parentPath(path) ?? ROOT_PATH, deps);
	if (!auth.ok) return auth;
	return run(() =>
		deps.writer.create({
			tenantId: auth.tenantId,
			actorUserId: auth.userId,
			path,
			description: description.trim(),
		}),
	);
}

export async function describeFolder(
	tenantSlug: string,
	path: string,
	description: string,
	deps: FolderDeps,
): Promise<FolderResult> {
	if (description.length > MAX_FOLDER_DESCRIPTION)
		return fail(
			"invalid",
			`La descripción tiene hasta ${MAX_FOLDER_DESCRIPTION} caracteres.`,
		);
	const auth = await authorize(tenantSlug, path, deps);
	if (!auth.ok) return auth;
	return run(() =>
		deps.writer.describe({
			tenantId: auth.tenantId,
			actorUserId: auth.userId,
			path,
			description: description.trim(),
		}),
	);
}

export async function deleteFolder(
	tenantSlug: string,
	path: string,
	deps: FolderDeps,
): Promise<FolderResult> {
	// Borrar una de primer nivel es una decisión sobre la raíz.
	const target = path.includes("/") ? path : ROOT_PATH;
	const auth = await authorize(tenantSlug, target, deps);
	if (!auth.ok) return auth;
	return run(() =>
		deps.writer.remove({
			tenantId: auth.tenantId,
			actorUserId: auth.userId,
			path,
		}),
	);
}
