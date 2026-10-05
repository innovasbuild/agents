// Paso previo al render (spec editor §7): cada wikilink fuera de código pasa a
// ser un link markdown con esquema wiki:, que <BrainMarkdown> resuelve a una
// ruta del tenant y marca como roto o archivado.
import { parseWikilinks } from "../wikilinks";

export const WIKI_SCHEME = "wiki:";

// Bloques ``` y código inline `...`: lo que matchea se deja tal cual.
const CODE = /```[\s\S]*?(?:```|$)|`[^`\n]*`/g;

function escapeText(text: string): string {
	return text.replace(/([[\]\\])/g, "\\$1");
}

// El destino de un link `(<...>)` en CommonMark puede llevar casi cualquier
// carácter, incluido el espacio, siempre que se escapen `<`, `>` y `\`. Sin
// los `< >`, un target con espacio (un wikilink escrito a mano que no
// resolvió a un slug, spec editor §4.1) corta el link y el resto queda como
// texto plano en vez de mostrarse roto.
function escapeDestination(destination: string): string {
	return destination.replace(/([<>\\])/g, "\\$1");
}

function replaceLinks(
	chunk: string,
	titleFor: (slug: string) => string | undefined,
): string {
	let out = "";
	let cursor = 0;
	for (const link of parseWikilinks(chunk)) {
		const text = link.alias ?? titleFor(link.target) ?? link.target;
		const anchor = link.anchor ? `#${link.anchor}` : "";
		const destination = escapeDestination(
			`${WIKI_SCHEME}${link.target}${anchor}`,
		);
		out += `${chunk.slice(cursor, link.start)}[${escapeText(text)}](<${destination}>)`;
		cursor = link.end;
	}
	return out + chunk.slice(cursor);
}

export function toMarkdownLinks(
	body: string,
	titleFor: (slug: string) => string | undefined,
): string {
	let out = "";
	let cursor = 0;
	for (const match of body.matchAll(CODE)) {
		const start = match.index ?? 0;
		out += replaceLinks(body.slice(cursor, start), titleFor) + match[0];
		cursor = start + match[0].length;
	}
	return out + replaceLinks(body.slice(cursor), titleFor);
}
