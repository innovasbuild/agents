// Parsers de las tablas de decisiones/ (spec etapa 25 §4.1b y §4.3).
import { extractLinks, isExternal, resolveLink } from "./wiki.ts";

/** Filas de datos de la primera tabla markdown del texto, celdas ya recortadas. */
export function parseTable(text: string): string[][] {
	const rows: string[][] = [];
	let header = false;
	for (const rawLine of text.split("\n")) {
		const line = rawLine.replace(/\r$/, "");
		if (!line.startsWith("|")) continue;
		const cells = line
			.replace(/^\||\|$/g, "")
			.split(/(?<!\\)\|/)
			.map((cell) => cell.trim().replaceAll("\\|", "|"));
		if (!header) {
			header = true;
			continue;
		}
		if (cells.every((cell) => /^-+$/.test(cell))) continue;
		rows.push(cells);
	}
	return rows;
}

export interface PrRow {
	number: number;
	date: string;
	title: string;
	/** Texto de la columna final: links a páginas o un motivo. */
	pagesOrReason: string;
}

export function parsePrTable(text: string): PrRow[] {
	const rows: PrRow[] = [];
	for (const [num, date, title, pagesOrReason] of parseTable(text)) {
		const match = /(\d+)/.exec(num ?? "");
		if (!match) continue;
		rows.push({
			number: Number(match[1]),
			date: date ?? "",
			title: title ?? "",
			pagesOrReason: pagesOrReason ?? "",
		});
	}
	return rows;
}

export interface SpecRow {
	date: string;
	stage: string;
	/** Path del repo de la spec, resuelto desde el link de la tabla. */
	spec: string;
	plan: string;
	state: string;
	/** Paths del repo de las páginas nombradas. */
	pages: string[];
}

function firstLinkTarget(cell: string, from: string): string {
	const link = extractLinks(cell).find((l) => !isExternal(l));
	return link ? resolveLink(from, link) : "";
}

export function parseSpecTable(text: string, from: string): SpecRow[] {
	return parseTable(text).map(([date, stage, spec, plan, state, pages]) => ({
		date: date ?? "",
		stage: stage ?? "",
		spec: firstLinkTarget(spec ?? "", from),
		plan: firstLinkTarget(plan ?? "", from),
		state: state ?? "",
		pages: extractLinks(pages ?? "")
			.filter((l) => !isExternal(l))
			.map((l) => resolveLink(from, l)),
	}));
}

/** Páginas a las que apunta una celda y el texto que queda sin los links. */
export function splitPagesAndReason(
	cell: string,
	from: string,
): { pages: string[]; reason: string } {
	return {
		pages: extractLinks(cell)
			.filter((l) => !isExternal(l))
			.map((l) => resolveLink(from, l)),
		reason: cell
			.replace(/\[[^\]]*\]\([^)]*\)/g, "")
			.replace(/[·,;]/g, " ")
			.replace(/\s+/g, " ")
			.trim(),
	};
}
