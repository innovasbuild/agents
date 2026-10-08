// Plan de limpieza de links al borrar una página (spec etapa 18.1 §3.2). Puro:
// recibe todas las páginas del tenant y devuelve las que hay que reescribir.
import type { BrainPage } from "./types";
import { removeWikilinks } from "./wikilinks";

export interface CleanupItem {
	slug: string;
	title: string;
	baseRevision: number;
	body: string;
}

export function planLinkCleanup(
	pages: BrainPage[],
	target: string,
): CleanupItem[] {
	// El título lo controla un admin del nodo y se escribe en cuerpos de páginas
	// que quizá no ve: sin corchetes no puede fabricar un link nuevo.
	const title = pages.find((p) => p.slug === target)?.title ?? "";
	const fallbackText =
		title.replace(/[[\]]/g, "").replace(/\s+/g, " ").trim() || target;
	const plan: CleanupItem[] = [];
	for (const page of pages) {
		// Incluye las archivadas (se pueden desarchivar) y excluye la propia.
		if (page.slug === target) continue;
		const body = removeWikilinks(page.body, target, fallbackText);
		if (body === page.body) continue;
		plan.push({
			slug: page.slug,
			title: page.title,
			baseRevision: page.revision,
			body,
		});
	}
	return plan;
}
