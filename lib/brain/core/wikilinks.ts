// Wikilinks del brain: [[slug]], [[slug|alias]], [[slug#ancla|alias]]. Los
// comparten el import (que los reescribe a slugs canónicos) y el editor (que
// arma conexiones y los renderiza). Sin imports: lo usa un script con Node.

export const WIKILINK_PATTERN = /\[\[([^\]|#]+)(#[^\]|]*)?(?:\|([^\]]+))?\]\]/g;

export interface Wikilink {
	target: string;
	anchor: string | null;
	alias: string | null;
	start: number;
	end: number;
}

export function parseWikilinks(body: string): Wikilink[] {
	const links: Wikilink[] = [];
	for (const match of body.matchAll(WIKILINK_PATTERN)) {
		const start = match.index ?? 0;
		links.push({
			target: match[1].trim(),
			anchor: match[2] ? match[2].slice(1).trim() || null : null,
			alias: match[3]?.trim() || null,
			start,
			end: start + match[0].length,
		});
	}
	return links;
}

// Bloques ``` y código en línea `...`: lo que matchea no se toca (lo comparten
// la vista de lectura y la limpieza de links del borrado).
export const CODE_PATTERN = /```[\s\S]*?(?:```|$)|`[^`\n]*`/g;

// Sacar los links a `target` de un texto sin código: [[t|alias]] pasa a su
// alias y el resto de las formas, a `fallbackText`. Lo demás queda igual.
function unlinkChunk(
	chunk: string,
	target: string,
	fallbackText: string,
): string {
	let out = "";
	let cursor = 0;
	for (const link of parseWikilinks(chunk)) {
		if (link.target !== target) continue;
		out += chunk.slice(cursor, link.start) + (link.alias ?? fallbackText);
		cursor = link.end;
	}
	return out + chunk.slice(cursor);
}

export function removeWikilinks(
	body: string,
	target: string,
	fallbackText: string,
): string {
	let out = "";
	let cursor = 0;
	for (const match of body.matchAll(CODE_PATTERN)) {
		const start = match.index ?? 0;
		out += unlinkChunk(body.slice(cursor, start), target, fallbackText);
		out += match[0];
		cursor = start + match[0].length;
	}
	return out + unlinkChunk(body.slice(cursor), target, fallbackText);
}
