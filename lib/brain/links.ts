// Conexiones entre páginas del brain, calculadas al leer (spec editor §4.2).
// Pura: recibe las páginas del tenant ya cargadas.
import type { BrainStatus } from "./types";
import { parseWikilinks } from "./wikilinks";

export interface LinkPage {
	slug: string;
	title: string;
	category: string;
	status: BrainStatus;
	body: string;
}

export interface OutgoingLink {
	target: string;
	alias: string | null;
	anchor: string | null;
	broken: boolean;
	archived: boolean;
}

export interface LinkIndex {
	outgoing: Map<string, OutgoingLink[]>;
	incoming: Map<string, string[]>;
	broken: { source: string; target: string }[];
	orphans: string[];
}

export function buildLinkIndex(pages: LinkPage[]): LinkIndex {
	const bySlug = new Map(pages.map((p) => [p.slug, p]));
	const outgoing = new Map<string, OutgoingLink[]>();
	const incomingSets = new Map<string, Set<string>>(
		pages.map((p) => [p.slug, new Set()]),
	);
	const broken: { source: string; target: string }[] = [];

	for (const source of pages) {
		const seen = new Set<string>();
		const links: OutgoingLink[] = [];
		for (const link of parseWikilinks(source.body)) {
			if (seen.has(link.target)) continue;
			seen.add(link.target);
			const target = bySlug.get(link.target);
			links.push({
				target: link.target,
				alias: link.alias,
				anchor: link.anchor,
				broken: !target,
				archived: target?.status === "archivado",
			});
			if (!target) broken.push({ source: source.slug, target: link.target });
			else if (target.slug !== source.slug && source.status !== "archivado")
				incomingSets.get(target.slug)?.add(source.slug);
		}
		outgoing.set(source.slug, links);
	}

	const incoming = new Map<string, string[]>();
	for (const [slug, set] of incomingSets) incoming.set(slug, [...set].sort());

	const orphans = pages
		.filter(
			(p) => p.status !== "archivado" && (incoming.get(p.slug)?.length ?? 0) === 0,
		)
		.map((p) => p.slug)
		.sort();

	return { outgoing, incoming, broken, orphans };
}
