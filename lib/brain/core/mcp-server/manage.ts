// Crear carpetas y borrar páginas desde el MCP, para quien administra (reemplaza
// D1 de la spec 18.1 solo para esta superficie). Reusa
// createFolder y deletePage de la web: el permiso, la limpieza de links y el
// todo o nada por página son los mismos. Acá se arma el pedido de un asistente:
// lotes, tope y lo que se saltea.
import { resolveAccess } from "../access/resolve-access.ts";
import {
	type AccessRule,
	atLeast,
	isAdministrator,
	type Principal,
} from "../access/types.ts";
import type { PageDeleter } from "../delete-store.ts";
import { type DeleteDeps, deletePage } from "../editor/delete.ts";
import { createFolder, type FolderDeps } from "../editor/folders.ts";
import {
	BrainError,
	BrainForbidden,
	BrainNotFound,
	BrainValidation,
} from "../errors.ts";
import type { FolderWriter } from "../folders-store.ts";
import { isReservedSlug } from "../reserved-slugs.ts";
import { isSkillSlug } from "../skills/package.ts";
import {
	type BrainPage,
	type BrainRole,
	MAX_SLUG_LENGTH,
	SLUG_PATTERN,
} from "../types.ts";

export const MAX_DELETE_PER_CALL = 50;
export const MAX_FOLDERS_PER_CALL = 20;

export interface BrainManageDeps {
	tenantSlug: string;
	actor: { tenantId: string; userId: string; role: BrainRole };
	/** Las reglas del tenant; vacías para un administrador, que no depende de ellas. */
	rules: AccessRule[];
	bindingId: string;
	/** Todas las páginas, SIN envolver con permisos: la limpieza ve también las ocultas. */
	pages(): Promise<BrainPage[]>;
	folders: FolderWriter;
	deleter: PageDeleter;
}

export type FolderOutcome =
	| { path: string; ok: true }
	| { path: string; ok: false; code: string; message: string };

export interface DeleteReport {
	deleted: Array<{ slug: string; cleaned: number }>;
	skipped: Array<{ slug: string; reason: string }>;
	/** Páginas que quedaron sin procesar por el tope de la llamada. */
	remaining: number;
	message?: string;
}

export interface BrainManage {
	createFolders(input: {
		folders: Array<{ path: string; description?: string }>;
	}): Promise<{ results: FolderOutcome[] }>;
	delete(input: {
		slug?: string;
		folder?: string;
		includeSubfolders?: boolean;
	}): Promise<DeleteReport>;
}

/** ¿Administra algo? Quien no, no ve estas tools. */
export function administersAnything(
	rules: AccessRule[],
	principal: Principal,
): boolean {
	if (isAdministrator(principal)) return true;
	return rules.some(
		(rule) =>
			rule.level === "administrador" &&
			atLeast(resolveAccess(rules, principal, rule.path), "administrador"),
	);
}

const depth = (path: string) => path.split("/").length;

function isValidPath(path: string): boolean {
	return (
		path.length > 0 && path.length <= MAX_SLUG_LENGTH && SLUG_PATTERN.test(path)
	);
}

export function createBrainManage(deps: BrainManageDeps): BrainManage {
	const principal: Principal = {
		kind: "user",
		userId: deps.actor.userId,
		role: deps.actor.role,
	};
	const base = {
		actor: async () => deps.actor,
		rules: { load: async () => deps.rules },
		binding: async () => ({ id: deps.bindingId, provider: "wiki" as const }),
	};
	const folderDeps: FolderDeps = { ...base, writer: deps.folders };

	// Una página: el pedido se arma con la lista fresca, porque borrar una
	// puede limpiar links de otras y cambiarles la revisión.
	async function deleteOne(
		slug: string,
	): Promise<
		{ ok: true; cleaned: number } | { ok: false; code: string; message: string }
	> {
		const pages = await deps.pages();
		const current = pages.find((p) => p.slug === slug);
		if (!current)
			return { ok: false, code: "not_found", message: "No encontrado." };
		const deleteDeps: DeleteDeps = {
			...base,
			pages: async () => pages,
			deleter: deps.deleter,
		};
		const result = await deletePage(
			deps.tenantSlug,
			slug,
			current.revision,
			deleteDeps,
		);
		return result.ok
			? { ok: true, cleaned: result.cleaned }
			: { ok: false, code: result.code, message: result.message };
	}

	function toError(
		slug: string,
		failure: { code: string; message: string },
	): BrainError {
		if (failure.code === "not_found") return new BrainNotFound(slug, []);
		if (failure.code === "forbidden")
			return new BrainForbidden(failure.message);
		if (failure.code === "conflict")
			return new BrainError("conflict", failure.message);
		return new BrainError("provider_unavailable", failure.message);
	}

	return {
		async createFolders({ folders }) {
			// Padre primero: los hijos necesitan que la carpeta de arriba exista.
			const seen = new Set<string>();
			const ordered = folders
				.filter((f) => !seen.has(f.path) && seen.add(f.path))
				.map((f, index) => ({ ...f, index }))
				.sort((a, b) => depth(a.path) - depth(b.path) || a.index - b.index);
			const results: FolderOutcome[] = [];
			for (const { path, description } of ordered) {
				const outcome = await createFolder(
					deps.tenantSlug,
					path,
					description ?? "",
					folderDeps,
				);
				results.push(
					outcome.ok
						? { path, ok: true }
						: { path, ok: false, code: outcome.code, message: outcome.message },
				);
			}
			return { results };
		},

		async delete({ slug, folder, includeSubfolders }) {
			if ((slug === undefined) === (folder === undefined)) {
				throw new BrainValidation(
					["slug", "folder"],
					"Pasá slug (una página) o folder (las páginas de una carpeta), uno solo.",
				);
			}

			if (slug !== undefined) {
				if (isSkillSlug(slug)) {
					throw new BrainForbidden(
						"Las skills no se borran por acá: un administrador las retira desde la plataforma.",
					);
				}
				const outcome = await deleteOne(slug);
				if (!outcome.ok) throw toError(slug, outcome);
				return {
					deleted: [{ slug, cleaned: outcome.cleaned }],
					skipped: [],
					remaining: 0,
				};
			}

			const target = folder as string;
			if (!isValidPath(target)) throw new BrainValidation(["folder"]);
			if (isSkillSlug(`${target}/`)) {
				throw new BrainForbidden(
					"Las skills no se borran por acá: un administrador las retira desde la plataforma.",
				);
			}
			if (resolveAccess(deps.rules, principal, target) === null) {
				throw new BrainError("not_found", `No existe la carpeta ${target}.`);
			}

			const prefix = `${target}/`;
			const inFolder = (await deps.pages())
				.map((p) => p.slug)
				.filter(
					(s) =>
						s.startsWith(prefix) &&
						(includeSubfolders || !s.slice(prefix.length).includes("/")),
				)
				// Lo que la persona no ve no se nombra (A8 de la Etapa 17).
				.filter((s) => resolveAccess(deps.rules, principal, s) !== null)
				.sort();

			const skipped: DeleteReport["skipped"] = [];
			const deletable: string[] = [];
			for (const s of inFolder) {
				if (isReservedSlug(s)) {
					skipped.push({
						slug: s,
						reason:
							"00-reglas y 00-plantilla no se borran en bloque: se borran nombrándolas por su ruta.",
					});
				} else if (
					resolveAccess(deps.rules, principal, s) !== "administrador"
				) {
					skipped.push({ slug: s, reason: "No administrás esta página." });
				} else {
					deletable.push(s);
				}
			}

			const batch = deletable.slice(0, MAX_DELETE_PER_CALL);
			const deleted: DeleteReport["deleted"] = [];
			// En un lote itera el código y un ítem que falla no frena al resto.
			for (const s of batch) {
				try {
					const outcome = await deleteOne(s);
					if (outcome.ok) deleted.push({ slug: s, cleaned: outcome.cleaned });
					else skipped.push({ slug: s, reason: outcome.message });
				} catch (error) {
					console.error(`brain mcp: no pude borrar ${s}`, error);
					skipped.push({
						slug: s,
						reason: "No se pudo borrar (error interno).",
					});
				}
			}

			const remaining = deletable.length - batch.length;
			const out: DeleteReport = { deleted, skipped, remaining };
			if (inFolder.length === 0) {
				out.message = `No hay páginas para borrar en ${target}${includeSubfolders ? "" : " (sin contar subcarpetas)"}.`;
			} else if (remaining > 0) {
				out.message = `Borré ${deleted.length} y quedan ${remaining}: volvé a llamar con el mismo folder para seguir.`;
			}
			return out;
		},
	};
}
