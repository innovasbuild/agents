// Value: protects=la lógica pura del mapa de conexiones (grado fijo, tamaño por raíz cuadrada, colores por categoría sin
//   colisión, atenuado de archivadas, entradas de graphology, tope del layout, posición sembrada, vecindario a N saltos,
//   filtros combinados con Y, búsqueda sin tildes y fecha es-AR) y que el componente de Sigma no arrastre node:*.
// fails_when=el tamaño no es monótono o se sale del rango, dos categorías dan el mismo color, una arista apunta a un
//   slug que no existe o es un autoenlace, el layout deja de tener tope, el vecindario cruza más saltos de los pedidos,
//   un filtro se combina con O en vez de Y, o "Politica" deja de encontrar "Política".
// why_new=el cliente de Sigma (26.4b) depende de estas funciones y no tenían cobertura; seam=none

import { describe, expect, it } from "vitest";
import type { GraphNode, GraphPayload } from "@/lib/brain/core/graph";
import {
	categoryColors,
	degrees,
	fadeColor,
	formatEditDate,
	type GraphFilters,
	layoutBudgetMs,
	matchesText,
	neighborhood,
	nodeSize,
	seedPosition,
	toGraphData,
	visibleNodes,
} from "@/lib/brain/core/graph-view";
import { nodeBuiltins } from "./client-safe";

const node = (
	slug: string,
	over: {
		title?: string;
		category?: number;
		status?: number;
		tags?: number[];
	} = {},
): GraphNode => [
	slug,
	over.title ?? slug,
	over.category ?? 0,
	over.status ?? 0,
	"2026-10-20T12:00:00Z",
	over.tags ?? [],
];

const filters = (over: Partial<GraphFilters> = {}): GraphFilters => ({
	categories: null,
	statuses: new Set([0, 1, 2]),
	tags: null,
	onlyOrphans: false,
	local: null,
	...over,
});

describe("degrees", () => {
	it("degrees cuenta vecinos distintos", () => {
		const nodes = [node("a"), node("b"), node("c"), node("d")];
		const edges: Array<[number, number]> = [
			[0, 1],
			[0, 2],
			[1, 0], // el mismo par al revés no suma
			[0, 1], // repetida
		];
		expect(degrees({ nodes, edges })).toEqual([2, 1, 1, 0]);
	});

	it("grafo vacío: arreglo vacío; un solo nodo: grado 0", () => {
		expect(degrees({ nodes: [], edges: [] })).toEqual([]);
		expect(degrees({ nodes: [node("a")], edges: [] })).toEqual([0]);
	});
});

describe("nodeSize", () => {
	it("nodeSize: grado 0 da el mínimo, el máximo grado da el máximo, es monótona, y un hub de 100 contra una hoja de 1 se ve claramente más grande pero acotado", () => {
		expect(nodeSize(0, 100)).toBe(3);
		expect(nodeSize(100, 100)).toBe(18);
		let previous = -1;
		for (let d = 0; d <= 100; d++) {
			const size = nodeSize(d, 100);
			expect(size).toBeGreaterThanOrEqual(previous);
			expect(size).toBeGreaterThanOrEqual(3);
			expect(size).toBeLessThanOrEqual(18);
			previous = size;
		}
		const leaf = nodeSize(1, 100);
		const hub = nodeSize(100, 100);
		expect(hub).toBeGreaterThan(leaf * 3);
		expect(hub).toBeLessThanOrEqual(18);
	});

	it("nodeSize con maxDegree 0 da el mínimo", () => {
		expect(nodeSize(0, 0)).toBe(3);
		expect(nodeSize(5, 0)).toBe(3);
		expect(nodeSize(0, 0, { min: 4, max: 10 })).toBe(4);
	});

	it("acota el grado a [0, maxDegree] y respeta el rango pedido", () => {
		expect(nodeSize(500, 100)).toBe(18);
		expect(nodeSize(-3, 100)).toBe(3);
		expect(nodeSize(100, 100, { min: 2, max: 8 })).toBe(8);
	});
});

describe("categoryColors", () => {
	const base = ["#112233", "rgb(200, 100, 50)", "#abcdef"];

	it("categoryColors repite sin colisión exacta cuando hay más categorías que colores", () => {
		const colors = categoryColors(base, 10);
		expect(colors).toHaveLength(10);
		expect(new Set(colors).size).toBe(10);
		for (const c of colors) expect(c).toMatch(/^rgb\(\d+, \d+, \d+\)$/);
	});

	it("la primera vuelta conserva los colores base y la siguiente los aclara", () => {
		const colors = categoryColors(base, 6);
		expect(colors.slice(0, 3)).toEqual([
			"rgb(17, 34, 51)",
			"rgb(200, 100, 50)",
			"rgb(171, 205, 239)",
		]);
		const sum = (c: string) =>
			(c.match(/\d+/g) ?? []).reduce((acc, n) => acc + Number(n), 0);
		expect(sum(colors[3])).toBeGreaterThan(sum(colors[0]));
	});

	it("la segunda vuelta oscurece", () => {
		const colors = categoryColors(base, 9);
		const sum = (c: string) =>
			(c.match(/\d+/g) ?? []).reduce((acc, n) => acc + Number(n), 0);
		expect(sum(colors[6])).toBeLessThan(sum(colors[0]));
	});

	it("base vacío da grises, y count 0 da arreglo vacío", () => {
		expect(categoryColors([], 2)).toEqual([
			"rgb(128, 128, 128)",
			"rgb(128, 128, 128)",
		]);
		expect(categoryColors(base, 0)).toEqual([]);
	});
});

describe("fadeColor", () => {
	it("mezcla hacia el destino en la proporción pedida", () => {
		expect(fadeColor("#000000", "rgb(200, 100, 50)", 0.5)).toBe(
			"rgb(100, 50, 25)",
		);
	});

	it("0 deja el color y 1 da el destino; fuera de rango se acota", () => {
		expect(fadeColor("#112233", "#ffffff", 0)).toBe("rgb(17, 34, 51)");
		expect(fadeColor("#112233", "#ffffff", 1)).toBe("rgb(255, 255, 255)");
		expect(fadeColor("#112233", "#ffffff", 7)).toBe("rgb(255, 255, 255)");
		expect(fadeColor("#112233", "#ffffff", -1)).toBe("rgb(17, 34, 51)");
	});

	it("entiende rgba (ignora la transparencia)", () => {
		expect(fadeColor("rgba(10, 20, 30, 0.5)", "#000000", 0)).toBe(
			"rgb(10, 20, 30)",
		);
	});
});

describe("toGraphData", () => {
	const payload = {
		nodes: [
			node("hub", { title: "Hub" }),
			node("hoja", { category: 1, status: 2 }),
			node("otra", { title: "" }),
			node("sola"),
		],
		edges: [
			[0, 1],
			[0, 2],
			[2, 2],
			[0, 9],
		] as Array<[number, number]>,
	};

	it("una entrada por nodo con clave = slug, título como etiqueta y posición sembrada", () => {
		const { nodes } = toGraphData(payload);
		expect(nodes.map((n) => n.key)).toEqual(["hub", "hoja", "otra", "sola"]);
		expect(nodes[0].attributes.label).toBe("Hub");
		expect(nodes[2].attributes.label).toBe("otra");
		expect(nodes[0].attributes).toMatchObject({
			index: 0,
			...seedPosition("hub"),
		});
		expect(nodes[1].attributes).toMatchObject({ category: 1, archived: true });
		expect(nodes[0].attributes.archived).toBe(false);
	});

	it("el hub es más grande que la hoja y la sola queda en el mínimo", () => {
		const { nodes } = toGraphData(payload);
		const size = (i: number) => nodes[i].attributes.size;
		expect(size(0)).toBe(nodeSize(2, 2));
		expect(size(0)).toBeGreaterThan(size(1));
		expect(size(3)).toBe(nodeSize(0, 2));
	});

	it("un link mutuo sale como dos entradas (las fusiona graph.import con merge)", () => {
		const mutual = toGraphData({
			nodes: [node("a"), node("b")],
			edges: [
				[0, 1],
				[1, 0],
			],
		});
		expect(mutual.edges).toEqual([
			{ source: "a", target: "b" },
			{ source: "b", target: "a" },
		]);
		// El grado cuenta vecinos distintos: el par mutuo no agranda el nodo.
		expect(mutual.nodes[0].attributes.size).toBe(nodeSize(1, 1));
	});

	it("aristas por slug, sin autoenlaces ni índices fuera de rango", () => {
		expect(toGraphData(payload).edges).toEqual([
			{ source: "hub", target: "hoja" },
			{ source: "hub", target: "otra" },
		]);
	});
});

describe("layoutBudgetMs", () => {
	it("6 s hasta 1.000 nodos y 21 s desde 10.000 (spike §2.1)", () => {
		expect(layoutBudgetMs(0)).toBe(6_000);
		expect(layoutBudgetMs(1_000)).toBe(6_000);
		expect(layoutBudgetMs(10_000)).toBe(21_000);
		expect(layoutBudgetMs(20_000)).toBe(21_000);
	});

	it("crece entre medio", () => {
		const mid = layoutBudgetMs(5_500);
		expect(mid).toBe(13_500);
		expect(layoutBudgetMs(3_000)).toBeLessThan(mid);
	});
});

describe("seedPosition", () => {
	it("seedPosition es estable y distinta entre slugs", () => {
		const a = seedPosition("comercial/ventas");
		expect(seedPosition("comercial/ventas")).toEqual(a);
		expect(seedPosition("comercial/precios")).not.toEqual(a);
	});

	it("cae dentro del círculo unidad", () => {
		for (const slug of ["a", "b", "c/d", "", "política/ñandú"]) {
			const { x, y } = seedPosition(slug);
			expect(Math.hypot(x, y)).toBeLessThan(1);
		}
	});
});

describe("neighborhood", () => {
	// 0 - 1 - 2 - 3 - 4, y 5 aislado
	const edges: Array<[number, number]> = [
		[0, 1],
		[1, 2],
		[2, 3],
		[3, 4],
	];
	const sorted = (set: Set<number>) => [...set].sort((a, b) => a - b);

	it("neighborhood a 1, 2 y 3 saltos", () => {
		expect(sorted(neighborhood(edges, 6, 2, 1))).toEqual([1, 2, 3]);
		expect(sorted(neighborhood(edges, 6, 2, 2))).toEqual([0, 1, 2, 3, 4]);
		expect(sorted(neighborhood(edges, 6, 0, 3))).toEqual([0, 1, 2, 3]);
	});

	it("no dirige: llega por aristas en cualquier sentido", () => {
		expect(sorted(neighborhood([[3, 2]], 4, 2, 1))).toEqual([2, 3]);
	});

	it("neighborhood de un nodo aislado es él solo", () => {
		expect(sorted(neighborhood(edges, 6, 5, 3))).toEqual([5]);
	});

	it("un inicio fuera de rango da conjunto vacío", () => {
		expect(neighborhood(edges, 6, 9, 2).size).toBe(0);
		expect(neighborhood(edges, 6, -1, 2).size).toBe(0);
		expect(neighborhood([], 0, 0, 1).size).toBe(0);
	});
});

describe("visibleNodes", () => {
	const payload: GraphPayload = {
		categories: ["comercial", "tech"],
		tags: ["x", "y"],
		nodes: [
			node("a", { category: 0, status: 0, tags: [0] }),
			node("b", { category: 1, status: 0, tags: [1] }),
			node("c", { category: 0, status: 2, tags: [0, 1] }),
			node("d", { category: 0, status: 0, tags: [] }),
			node("e", { category: 1, status: 1, tags: [0] }),
		],
		edges: [
			[0, 1],
			[1, 2],
			[2, 3],
		],
		broken: [],
		orphans: [0, 3, 4],
		total: 5,
		truncated: false,
	};
	const ids = (f: Partial<GraphFilters>) =>
		[...visibleNodes(payload, filters(f))].sort((a, b) => a - b);

	it("sin restricciones muestra todo", () => {
		expect(ids({})).toEqual([0, 1, 2, 3, 4]);
	});

	it("visibleNodes: categorías, estados, tags (al menos uno), huérfanas y vecindario se combinan con Y", () => {
		expect(ids({ categories: new Set([0]) })).toEqual([0, 2, 3]);
		expect(ids({ statuses: new Set([0]) })).toEqual([0, 1, 3]);
		expect(ids({ statuses: new Set() })).toEqual([]);
		expect(ids({ tags: new Set([1]) })).toEqual([1, 2]);
		expect(ids({ tags: new Set([0, 1]) })).toEqual([0, 1, 2, 4]);
		expect(ids({ onlyOrphans: true })).toEqual([0, 3, 4]);
		expect(ids({ local: { node: 1, hops: 1 } })).toEqual([0, 1, 2]);

		expect(
			ids({
				categories: new Set([0]),
				statuses: new Set([0]),
				onlyOrphans: true,
			}),
		).toEqual([0, 3]);
		expect(
			ids({
				categories: new Set([0]),
				tags: new Set([0]),
				local: { node: 1, hops: 2 },
			}),
		).toEqual([0, 2]);
	});

	it("grafo vacío no muestra nada", () => {
		const empty: GraphPayload = {
			...payload,
			nodes: [],
			edges: [],
			orphans: [],
			total: 0,
		};
		expect(visibleNodes(empty, filters()).size).toBe(0);
	});
});

describe("matchesText", () => {
	const page = node("comercial/politica-de-ventas", {
		title: "Política de ventas",
	});

	it('matchesText ignora tildes y mayúsculas ("Politica" encuentra "Política de ventas")', () => {
		expect(matchesText(page, "Politica")).toBe(true);
		expect(matchesText(page, "POLÍTICA DE")).toBe(true);
		expect(matchesText(node("x", { title: "Ñandú" }), "nandu")).toBe(true);
	});

	it("también busca en el slug", () => {
		expect(matchesText(page, "comercial/pol")).toBe(true);
		expect(matchesText(page, "marketing")).toBe(false);
	});

	it("una consulta vacía o de espacios no coincide con nada", () => {
		expect(matchesText(page, "")).toBe(false);
		expect(matchesText(page, "   ")).toBe(false);
	});
});

describe("formatEditDate", () => {
	it("formatEditDate da día, mes corto y año en es-AR", () => {
		expect(formatEditDate("2026-10-20T12:00:00Z")).toMatch(/^20 oct\.? 2026$/);
	});

	it("usa la zona de Buenos Aires: 01:00Z todavía es el día anterior", () => {
		expect(formatEditDate("2026-10-21T01:00:00Z")).toMatch(/^20 oct\.? 2026$/);
	});

	it("una fecha inválida da cadena vacía y no lanza", () => {
		expect(formatEditDate("no es fecha")).toBe("");
		expect(formatEditDate("")).toBe("");
	});
});

describe("graph-view en el cliente", () => {
	it("no arrastra node:* ni builtins de Node", () => {
		expect(nodeBuiltins("lib/brain/core/graph-view.ts")).toEqual([]);
	});

	it("el componente del grafo tampoco", () => {
		expect(nodeBuiltins("components/brain/graph/brain-graph.tsx")).toEqual([]);
	});
});
