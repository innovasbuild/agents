// Payload compacto del mapa de conexiones del brain (spec 26.4, D10, D14, D15).
// Puro: recibe las páginas visibles y el índice de links ya calculado, y los
// vuelca en arrays e índices para que el route handler los sirva y el cliente
// los recorra sin repetir claves.
import type { LinkIndex } from "./links";
import type { BrainPageMeta } from "./types";

export const GRAPH_STATUSES = ["activo", "borrador", "archivado"] as const;

// Fijado por el spike de la 26.4a (spec D8): por encima, se muestran las más
// conectadas con un aviso.
export const GRAPH_MAX_NODES = 20_000;

export type GraphNode = [
	slug: string,
	title: string,
	category: number,
	status: number,
	updatedAt: string,
	tags: number[],
];

export interface GraphPayload {
	categories: string[];
	tags: string[];
	nodes: GraphNode[];
	edges: Array<[number, number]>;
	broken: Array<[target: string, sources: number[]]>;
	orphans: number[];
	total: number;
	truncated: boolean;
}

// Orden por código de unidad: igual en cualquier entorno y coherente con `<`.
const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

const sortedUnique = (values: Iterable<string>) =>
	[...new Set(values)].sort(cmp);

export function buildGraphPayload(
	pages: BrainPageMeta[],
	index: LinkIndex,
	options: { maxNodes?: number } = {},
): GraphPayload {
	const maxNodes = options.maxNodes ?? GRAPH_MAX_NODES;
	const total = pages.length;
	const slugs = new Set(pages.map((p) => p.slug));

	// Aristas sin orden, por slug (a < b): links salientes a páginas que existen,
	// sin autoenlaces y sin duplicados. Incluye las archivadas (D14).
	const pairs = new Map<string, [string, string]>();
	const neighbors = new Map<string, Set<string>>();
	for (const [source, links] of index.outgoing) {
		if (!slugs.has(source)) continue;
		for (const link of links) {
			if (link.broken || link.target === source || !slugs.has(link.target))
				continue;
			const [a, b] =
				cmp(source, link.target) < 0
					? [source, link.target]
					: [link.target, source];
			pairs.set(`${a}\u0000${b}`, [a, b]);
			for (const [from, to] of [
				[a, b],
				[b, a],
			]) {
				const set = neighbors.get(from) ?? new Set<string>();
				set.add(to);
				neighbors.set(from, set);
			}
		}
	}

	// Tope: las que tienen más vecinos distintos; empata el slug ascendente.
	let kept = pages;
	if (total > maxNodes) {
		const degree = (slug: string) => neighbors.get(slug)?.size ?? 0;
		kept = [...pages]
			.sort((p, q) => degree(q.slug) - degree(p.slug) || cmp(p.slug, q.slug))
			.slice(0, maxNodes);
	}
	const ordered = [...kept].sort((p, q) => cmp(p.slug, q.slug));
	const position = new Map(ordered.map((p, i) => [p.slug, i]));

	const categories = sortedUnique(ordered.map((p) => p.category));
	const tags = sortedUnique(ordered.flatMap((p) => p.tags));
	const categoryAt = new Map(categories.map((c, i) => [c, i]));
	const tagAt = new Map(tags.map((t, i) => [t, i]));

	const nodes: GraphNode[] = ordered.map((p) => [
		p.slug,
		p.title,
		categoryAt.get(p.category) ?? 0,
		GRAPH_STATUSES.indexOf(p.status),
		p.updatedAt,
		p.tags.map((t) => tagAt.get(t) ?? 0),
	]);

	// a < b por slug y las posiciones siguen el mismo orden: i < j.
	const edges: Array<[number, number]> = [];
	for (const [a, b] of pairs.values()) {
		const i = position.get(a);
		const j = position.get(b);
		if (i !== undefined && j !== undefined) edges.push([i, j]);
	}
	edges.sort((x, y) => x[0] - y[0] || x[1] - y[1]);

	const sourcesOf = new Map<string, Set<number>>();
	for (const { source, target } of index.broken) {
		const at = position.get(source);
		if (at === undefined) continue;
		const set = sourcesOf.get(target) ?? new Set<number>();
		set.add(at);
		sourcesOf.set(target, set);
	}
	const broken: GraphPayload["broken"] = [...sourcesOf.keys()]
		.sort(cmp)
		.map((target) => [
			target,
			[...(sourcesOf.get(target) ?? [])].sort((x, y) => x - y),
		]);

	const orphans = index.orphans
		.flatMap((slug) => {
			const at = position.get(slug);
			return at === undefined ? [] : [at];
		})
		.sort((x, y) => x - y);

	return {
		categories,
		tags,
		nodes,
		edges,
		broken,
		orphans,
		total,
		truncated: total > maxNodes,
	};
}
