// Autocompletado de [[ en el cuerpo (spec editor §5.2). Puro para testearlo
// sin DOM; el formulario solo lo conecta al textarea.

export function wikilinkQueryAt(
	text: string,
	cursor: number,
): { start: number; query: string } | null {
	const before = text.slice(0, cursor);
	const start = before.lastIndexOf("[[");
	if (start === -1) return null;
	const query = before.slice(start + 2);
	if (/[\]\n|]/.test(query)) return null;
	return { start, query };
}

export function sanitizeAlias(title: string): string {
	return title
		.replace(/[[\]|]/g, "")
		.replace(/\s+/g, " ")
		.trim();
}

export function insertWikilink(
	text: string,
	start: number,
	cursor: number,
	slug: string,
	title: string,
) {
	const link = `[[${slug}|${sanitizeAlias(title)}]]`;
	return {
		text: text.slice(0, start) + link + text.slice(cursor),
		cursor: start + link.length,
	};
}
