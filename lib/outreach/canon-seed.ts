// Crea las páginas por defecto del canon en un brain recién creado (spec 21.3
// §3.6). Sin baseRevision el brain solo crea páginas nuevas: una que ya
// existe da conflicto y se deja como está.
import { createHash } from "node:crypto";
import { BrainConflict } from "../brain/core/errors";
import type { BrainProvider } from "../brain/core/types";
import { brainForTenant, CANON_TAGS_FOR_DRAFT } from "./canon";
import { DEFAULT_CANON_PAGES } from "./canon-templates";

/**
 * Si el brain ya tiene alguna página con tag de canon. Una empresa que cargó su
 * canon con otros slugs no recibe plantillas: loadCanon lee también
 * los borradores y las pasaría a la redacción.
 */
async function hasCanon(brain: BrainProvider): Promise<boolean> {
	for (const tag of CANON_TAGS_FOR_DRAFT) {
		const found = await brain.search({ query: "", tag, limit: 1 });
		if (found.length > 0) return true;
	}
	return false;
}

export async function seedCanonPages(
	brain: BrainProvider | null,
	userId: string,
): Promise<boolean> {
	if (!brain) return false;
	try {
		if (await hasCanon(brain)) return true;
	} catch (error) {
		// Sin saber si ya hay canon no se siembra: una plantilla de más se lee.
		console.error("canon: no pude ver si el brain ya tiene canon:", error);
		return false;
	}
	let allOk = true;
	for (const page of DEFAULT_CANON_PAGES) {
		try {
			await brain.upsert(
				{
					slug: page.slug,
					title: page.title,
					category: page.category,
					status: "borrador",
					tags: [...page.tags],
					body: page.body,
					reason: "Página por defecto al crear el brain",
				},
				{
					kind: "import",
					userId,
					sourcePath: `plantilla:${page.slug}`,
					sourceHash: createHash("sha256").update(page.body).digest("hex"),
				},
			);
		} catch (error) {
			if (error instanceof BrainConflict) continue;
			// Incluye la categoría "comercial" ausente del brain: se loguea, no se tira.
			console.error(`canon: no pude crear ${page.slug}:`, error);
			allOk = false;
		}
	}
	return allOk;
}

export async function seedCanonPagesForTenant(
	tenantId: string,
	userId: string,
): Promise<boolean> {
	try {
		return await seedCanonPages(await brainForTenant(tenantId), userId);
	} catch (error) {
		console.error("canon: no pude abrir el brain para sembrarlo:", error);
		return false;
	}
}
