// Guardado del editor (spec editor §5.3). La escritura corre con service role
// por provider.upsert, así que el rol se chequea acá: la RLS no protege este
// camino. Sin Next: la server action solo arma las dependencias reales.
import {
	BrainConflict,
	BrainForbidden,
	BrainNotFound,
	BrainValidation,
} from "../errors";
import type { BrainBinding } from "../resolve";
import type {
	BrainProvider,
	BrainRole,
	BrainStatus,
	BrainWrite,
} from "../types";

export interface SavePageInput {
	tenantSlug: string;
	slug: string;
	title: string;
	category: string;
	status: BrainStatus;
	tags: string[];
	frontmatter: Record<string, unknown>;
	body: string;
	reason: string;
	baseRevision: number | null;
}

export type SavePageResult =
	| { ok: true; slug: string; revision: number }
	| {
			ok: false;
			code: "forbidden" | "unsupported" | "internal";
			message: string;
	  }
	| {
			ok: false;
			code: "conflict";
			currentRevision: number | null;
			message: string;
	  }
	| { ok: false; code: "validation"; fields: string[]; message: string };

export interface SaveDeps {
	access(
		tenantSlug: string,
	): Promise<{ tenantId: string; role: BrainRole; userId: string } | null>;
	binding(tenantId: string): Promise<BrainBinding | null>;
	provider(
		binding: BrainBinding,
		actor: { tenantId: string; role: BrainRole; userId: string },
	): Promise<BrainProvider>;
}

export async function savePage(
	input: SavePageInput,
	deps: SaveDeps,
): Promise<SavePageResult> {
	const access = await deps.access(input.tenantSlug);
	if (!access)
		return {
			ok: false,
			code: "forbidden",
			message: "No tenés permiso para editar el brain.",
		};

	const binding = await deps.binding(access.tenantId);
	if (!binding || binding.provider !== "wiki")
		return {
			ok: false,
			code: "unsupported",
			message: "Este brain no se edita desde la plataforma.",
		};

	if (input.reason.trim().length === 0)
		return {
			ok: false,
			code: "validation",
			fields: ["reason"],
			message: "Falta el motivo del cambio.",
		};

	const write: BrainWrite = {
		slug: input.slug,
		title: input.title,
		category: input.category,
		status: input.status,
		tags: input.tags,
		frontmatter: input.frontmatter,
		body: input.body,
		reason: input.reason.trim(),
		...(input.baseRevision === null
			? {}
			: { baseRevision: input.baseRevision }),
	};

	try {
		const provider = await deps.provider(binding, access);
		const saved = await provider.upsert(write, {
			kind: "user",
			userId: access.userId,
		});
		return { ok: true, slug: saved.slug, revision: saved.revision };
	} catch (error) {
		// Sin permiso de escritura sobre esa página (o sobre algo que no ve): la
		// pantalla muestra lo mismo, sin confirmar si existe.
		if (error instanceof BrainForbidden || error instanceof BrainNotFound)
			return {
				ok: false,
				code: "forbidden",
				message: "No tenés permiso para editar esta parte del brain.",
			};
		if (error instanceof BrainConflict) {
			// Al crear (baseRevision null), brain_upsert_page devuelve en el
			// conflicto la revisión de la página EXISTENTE, no la de esta. No hay
			// revisión propia contra la cual reintentar: forzar null evita que la
			// pantalla ofrezca "reintentar" y termine pisando esa otra página.
			const currentRevision =
				input.baseRevision === null ? null : error.currentRevision;
			return {
				ok: false,
				code: "conflict",
				currentRevision,
				message:
					input.baseRevision === null
						? "Ya existe una página con ese slug."
						: `Alguien guardó la revisión ${error.currentRevision ?? "nueva"} mientras editabas.`,
			};
		}
		if (error instanceof BrainValidation)
			return {
				ok: false,
				code: "validation",
				fields: error.fields,
				message: error.message,
			};
		const id = crypto.randomUUID();
		console.error(`brain editor: error al guardar (${id})`, error);
		return {
			ok: false,
			code: "internal",
			message: `No se pudo guardar (${id}).`,
		};
	}
}
