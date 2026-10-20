// Value: protects=el payload del grafo (nodos, aristas sin orden ni duplicados ni autoenlaces, rotos agrupados por destino,
//   huérfanas de LinkIndex y truncado por grado con remapeo) que sirve el mapa de conexiones del brain.
// fails_when=una arista sale duplicada o con autoenlace, un roto genera arista, las archivadas desaparecen, o el truncado
//   deja índices que apuntan a nodos descartados.
// why_new=el mapa de conexiones (26.4b) es una pieza nueva sin cobertura; seam=none

import { describe, expect, it } from "vitest";
import { buildGraphPayload, GRAPH_MAX_NODES } from "@/lib/brain/core/graph";
import {
	buildLinkIndexFromLinks,
	type LinkIndex,
} from "@/lib/brain/core/links";
import type { BrainPageMeta, BrainStatus } from "@/lib/brain/core/types";

function page(slug: string, over: Partial<BrainPageMeta> = {}): BrainPageMeta {
	return {
		slug,
		title: slug.toUpperCase(),
		category: "general",
		status: "activo" as BrainStatus,
		tags: [],
		revision: 1,
		updatedAt: "2026-10-01T10:00:00.000Z",
		...over,
	};
}

// Arma el índice real a partir de { slug: [destinos escritos] }.
function indexOf(
	pages: BrainPageMeta[],
	links: Record<string, string[]> = {},
): LinkIndex {
	return buildLinkIndexFromLinks(
		pages,
		Object.entries(links).map(([slug, targets]) => ({
			slug,
			links: targets.map((target) => ({ target, anchor: null, alias: null })),
		})),
	);
}

function graph(
	pages: BrainPageMeta[],
	links: Record<string, string[]> = {},
	maxNodes?: number,
) {
	return buildGraphPayload(pages, indexOf(pages, links), { maxNodes });
}

describe("buildGraphPayload", () => {
	it("cada nodo lleva título, categoría, estado, fecha y tags por índice", () => {
		const g = graph([
			page("zeta", {
				title: "Zeta",
				category: "ventas",
				status: "borrador",
				updatedAt: "2026-09-30T00:00:00.000Z",
				tags: ["b", "a"],
			}),
			page("alfa", { title: "Alfa", category: "producto", tags: ["a"] }),
		]);
		expect(g.categories).toEqual(["producto", "ventas"]);
		expect(g.tags).toEqual(["a", "b"]);
		expect(g.nodes).toEqual([
			["alfa", "Alfa", 0, 0, "2026-10-01T10:00:00.000Z", [0]],
			["zeta", "Zeta", 1, 1, "2026-09-30T00:00:00.000Z", [1, 0]],
		]);
		expect(g.total).toBe(2);
		expect(g.truncated).toBe(false);
	});

	it("A→B y B→A dan una sola arista", () => {
		const g = graph([page("a"), page("b")], { a: ["b"], b: ["a"] });
		expect(g.edges).toEqual([[0, 1]]);
	});

	it("un link repetido da una sola arista", () => {
		const g = graph([page("a"), page("b")], { a: ["b", "b", "b"] });
		expect(g.edges).toEqual([[0, 1]]);
	});

	it("un autoenlace no da arista", () => {
		const g = graph([page("a")], { a: ["a"] });
		expect(g.edges).toEqual([]);
		expect(g.nodes).toHaveLength(1);
	});

	it("un link roto no da arista y queda en broken con sus orígenes", () => {
		const g = graph([page("a"), page("b")], { b: ["fantasma"] });
		expect(g.edges).toEqual([]);
		expect(g.broken).toEqual([["fantasma", [1]]]);
	});

	it("dos páginas que apuntan al mismo destino roto comparten una entrada", () => {
		const g = graph([page("a"), page("b"), page("c")], {
			c: ["nada", "otro"],
			a: ["nada"],
		});
		expect(g.broken).toEqual([
			["nada", [0, 2]],
			["otro", [2]],
		]);
	});

	it("las archivadas siguen en nodos y aristas", () => {
		const g = graph([page("a", { status: "archivado" }), page("b")], {
			a: ["b"],
			b: ["a"],
		});
		expect(g.nodes.map((n) => [n[0], n[3]])).toEqual([
			["a", 2],
			["b", 0],
		]);
		expect(g.edges).toEqual([[0, 1]]);
	});

	it("orphans coincide con LinkIndex.orphans", () => {
		const pages = [
			page("a"),
			page("b"),
			page("c"),
			page("d", { status: "archivado" }),
		];
		const index = indexOf(pages, { a: ["b"], c: ["b"] });
		const g = buildGraphPayload(pages, index);
		expect(g.orphans.map((i) => g.nodes[i][0])).toEqual(index.orphans);
		expect(index.orphans).toEqual(["a", "c"]);
	});

	it("brain vacío", () => {
		expect(graph([])).toEqual({
			categories: [],
			tags: [],
			nodes: [],
			edges: [],
			broken: [],
			orphans: [],
			total: 0,
			truncated: false,
		});
	});

	it("una sola página", () => {
		const g = graph([page("sola", { tags: ["x"] })]);
		expect(g.nodes).toEqual([
			["sola", "SOLA", 0, 0, "2026-10-01T10:00:00.000Z", [0]],
		]);
		expect(g.edges).toEqual([]);
		expect(g.broken).toEqual([]);
		expect(g.orphans).toEqual([0]);
		expect(g.total).toBe(1);
	});

	it("un brain sin ningún link no tiene aristas y todas son huérfanas", () => {
		const g = graph([page("a"), page("b"), page("c")]);
		expect(g.edges).toEqual([]);
		expect(g.broken).toEqual([]);
		expect(g.orphans).toEqual([0, 1, 2]);
	});

	it("con maxNodes se queda con las más conectadas, desempata por slug, remapea aristas, rotos y huérfanas y marca truncated y total", () => {
		// Grados: hub 3 (b, c, d); b, c y d 2 cada una; e 1 (solo d). Se conservan 3:
		// hub y, empatadas en 2, b y c por slug. d y e quedan afuera.
		const pages = [
			page("e", { category: "solo-e", tags: ["tag-e"] }),
			page("d"),
			page("c", { tags: ["tag-c"] }),
			page("b"),
			page("hub"),
		];
		const g = graph(
			pages,
			{
				hub: ["b", "c", "d", "roto-compartido"],
				b: ["c"],
				e: ["d", "roto-solo-de-e", "roto-compartido"],
			},
			3,
		);
		expect(g.total).toBe(5);
		expect(g.truncated).toBe(true);
		expect(g.nodes.map((n) => n[0])).toEqual(["b", "c", "hub"]);
		expect(g.edges).toEqual([
			[0, 1],
			[0, 2],
			[1, 2],
		]);
		// tablas reconstruidas sobre los nodos conservados
		expect(g.categories).toEqual(["general"]);
		expect(g.tags).toEqual(["tag-c"]);
		expect(g.nodes[1][5]).toEqual([0]);
		// el roto que solo apuntaba e desaparece; el compartido conserva solo a hub
		expect(g.broken).toEqual([["roto-compartido", [2]]]);
		// huérfanas: hub no tiene entrantes; b y c sí
		expect(g.orphans).toEqual([2]);
	});

	it("en el truncado, el empate de grado lo resuelve el slug ascendente", () => {
		const g = graph([page("c"), page("b"), page("a")], {}, 2);
		expect(g.nodes.map((n) => n[0])).toEqual(["a", "b"]);
		expect(g.truncated).toBe(true);
		expect(g.total).toBe(3);
	});

	it("sin maxNodes el tope es GRAPH_MAX_NODES y no trunca por debajo", () => {
		expect(GRAPH_MAX_NODES).toBe(20_000);
		expect(graph([page("a"), page("b")]).truncated).toBe(false);
	});
});
