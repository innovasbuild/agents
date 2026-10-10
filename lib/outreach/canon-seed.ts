// Crea las páginas por defecto del canon en un brain recién creado (spec 21.3
// §3.6). Sin baseRevision el brain solo crea páginas nuevas: una que ya
// existe da conflicto y se deja como está.
import { createHash } from "node:crypto";
import { BrainConflict } from "../brain/core/errors";
import type { BrainProvider } from "../brain/core/types";
import { brainForTenant } from "./canon";
import { DEFAULT_CANON_PAGES } from "./canon-templates";

export async function seedCanonPages(
	brain: BrainProvider | null,
	userId: string,
): Promise<boolean> {
	if (!brain) return false;
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
