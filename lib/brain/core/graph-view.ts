// Lógica pura del mapa de conexiones del brain que corre en el cliente (spec 26.4:
// D4 tamaño, D5 color, D7 filtros, D11 posición inicial, D14 grado fijo). Se
// importa desde un Client Component: sin node:*, sin react ni next/*.
import { GRAPH_STATUSES, type GraphNode, type GraphPayload } from "./graph";

// Vecinos distintos de cada nodo sobre las aristas. Se calcula una vez y queda
// fijo: no cambia al activar filtros (D14).
export function degrees(
	payload: Pick<GraphPayload, "nodes" | "edges">,
): number[] {
	const neighbors = payload.nodes.map(() => new Set<number>());
	for (const [a, b] of payload.edges) {
		if (a === b || !neighbors[a] || !neighbors[b]) continue;
		neighbors[a].add(b);
		neighbors[b].add(a);
	}
	return neighbors.map((set) => set.size);
}

// Raíz cuadrada entre min y max: un hub no tapa al resto (D4).
export function nodeSize(
	degree: number,
	maxDegree: number,
	range: { min: number; max: number } = { min: 3, max: 18 },
): number {
	if (!(maxDegree > 0)) return range.min;
	const clamped = Math.min(Math.max(degree, 0), maxDegree);
	return range.min + (range.max - range.min) * Math.sqrt(clamped / maxDegree);
}

type Rgb = [number, number, number];

const GRAY: Rgb = [128, 128, 128];

function parseColor(color: string): Rgb {
	const hex = /^#([0-9a-f]{6})$/i.exec(color.trim());
	if (hex) {
		const n = Number.parseInt(hex[1], 16);
		return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
	}
	const rgb = /^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/i.exec(color.trim());
	if (rgb) return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])];
	return GRAY;
}

const mix = (from: Rgb, to: number, amount: number): Rgb =>
	[0, 1, 2].map((i) => Math.round(from[i] + (to - from[i]) * amount)) as Rgb;

// La categoría i usa base[i % base.length]. Cada vuelta posterior alterna
// aclarar (hacia blanco) y oscurecer (hacia negro), con más fuerza cada dos
// vueltas, para que dos categorías no repitan el color exacto (D5).
export function categoryColors(base: string[], count: number): string[] {
	const parsed = base.map(parseColor);
	return Array.from({ length: Math.max(count, 0) }, (_, i) => {
		if (parsed.length === 0) return `rgb(${GRAY.join(", ")})`;
		const color = parsed[i % parsed.length];
		const lap = Math.floor(i / parsed.length);
		let out = color;
		if (lap > 0) {
			const amount = Math.min(0.35 + 0.15 * Math.floor((lap - 1) / 2), 0.8);
			out = lap % 2 === 1 ? mix(color, 255, amount) : mix(color, 0, amount);
		}
		return `rgb(${out.join(", ")})`;
	});
}

// Lleva `color` hacia `toward` en la proporción `amount` (0 = igual, 1 = toward).
// Atenúa las archivadas mezclándolas con el fondo, sin depender de la
// transparencia del lienzo (D5).
export function fadeColor(
	color: string,
	toward: string,
	amount: number,
): string {
	const from = parseColor(color);
	const to = parseColor(toward);
	const t = Math.min(Math.max(amount, 0), 1);
	const out = [0, 1, 2].map((i) => Math.round(from[i] + (to[i] - from[i]) * t));
	return `rgb(${out.join(", ")})`;
}

// FNV-1a de 32 bits sobre las unidades UTF-16 del texto.
function fnv1a(text: string): number {
	let hash = 0x811c9dc5;
	for (let i = 0; i < text.length; i++) {
		hash ^= text.charCodeAt(i);
		hash = Math.imul(hash, 0x01000193);
	}
	return hash >>> 0;
}

// Posición inicial sembrada desde el slug (D11): igual en servidor y cliente,
// dentro del círculo unidad con la raíz cuadrada para repartir parejo.
export function seedPosition(slug: string): { x: number; y: number } {
	const angle = (fnv1a(slug) / 2 ** 32) * 2 * Math.PI;
	const radius = Math.sqrt(fnv1a(`${slug}\u0001`) / 2 ** 32);
	return { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius };
}

export interface GraphNodeAttributes {
	index: number; // posición en payload.nodes
	label: string;
	x: number;
	y: number;
	size: number;
	category: number;
	archived: boolean;
}

const ARCHIVED = GRAPH_STATUSES.indexOf("archivado");

// Entradas para `graph.import()` de graphology: clave = slug, posición sembrada
// (D11), tamaño por grado fijo (D4). El color lo pone quien dibuja, porque
// depende del tema.
export function toGraphData(payload: Pick<GraphPayload, "nodes" | "edges">): {
	nodes: Array<{ key: string; attributes: GraphNodeAttributes }>;
	edges: Array<{ source: string; target: string }>;
} {
	const degree = degrees(payload);
	const maxDegree = degree.reduce((max, d) => Math.max(max, d), 0);
	const nodes = payload.nodes.map(([slug, title, category, status], i) => ({
		key: slug,
		attributes: {
			index: i,
			label: title || slug,
			...seedPosition(slug),
			size: nodeSize(degree[i], maxDegree),
			category,
			archived: status === ARCHIVED,
		},
	}));
	// Un link mutuo (a→b y b→a) sale como dos entradas: graph.import(..., true)
	// las fusiona en una sola arista no dirigida.
	const edges: Array<{ source: string; target: string }> = [];
	for (const [a, b] of payload.edges) {
		const source = payload.nodes[a]?.[0];
		const target = payload.nodes[b]?.[0];
		if (source === undefined || target === undefined || a === b) continue;
		edges.push({ source, target });
	}
	return { nodes, edges };
}

// Tiempo de layout acotado (spec §2.1 a): el spike midió 6 s hasta asentar con
// 1.000 nodos y 20–21 s con 10.000. Entre medio se interpola; por encima queda
// en el tope de 10.000, aunque no termine de asentar.
export function layoutBudgetMs(nodeCount: number): number {
	const [n0, t0, n1, t1] = [1_000, 6_000, 10_000, 21_000];
	if (!(nodeCount > n0)) return t0;
	if (nodeCount >= n1) return t1;
	return Math.round(t0 + ((t1 - t0) * (nodeCount - n0)) / (n1 - n0));
}

// Búsqueda en anchura sin dirección; incluye al nodo de inicio.
export function neighborhood(
	edges: Array<[number, number]>,
	nodeCount: number,
	start: number,
	hops: 1 | 2 | 3,
): Set<number> {
	const reached = new Set<number>();
	if (!Number.isInteger(start) || start < 0 || start >= nodeCount)
		return reached;
	const adjacent: number[][] = Array.from({ length: nodeCount }, () => []);
	for (const [a, b] of edges) {
		if (!adjacent[a] || !adjacent[b]) continue;
		adjacent[a].push(b);
		adjacent[b].push(a);
	}
	reached.add(start);
	let frontier = [start];
	for (let hop = 0; hop < hops && frontier.length > 0; hop++) {
		const next: number[] = [];
		for (const node of frontier)
			for (const other of adjacent[node])
				if (!reached.has(other)) {
					reached.add(other);
					next.push(other);
				}
		frontier = next;
	}
	return reached;
}

export interface GraphFilters {
	categories: Set<number> | null; // null = todas
	statuses: Set<number>;
	tags: Set<number> | null; // null = todos; si no, al menos uno del conjunto
	onlyOrphans: boolean;
	local: { node: number; hops: 1 | 2 | 3 } | null;
}

// Todos los filtros se combinan con Y.
export function visibleNodes(
	payload: GraphPayload,
	filters: GraphFilters,
): Set<number> {
	const orphans = filters.onlyOrphans ? new Set(payload.orphans) : null;
	const local = filters.local
		? neighborhood(
				payload.edges,
				payload.nodes.length,
				filters.local.node,
				filters.local.hops,
			)
		: null;
	const visible = new Set<number>();
	payload.nodes.forEach(([, , category, status, , tags], i) => {
		if (filters.categories && !filters.categories.has(category)) return;
		if (!filters.statuses.has(status)) return;
		const wanted = filters.tags;
		if (wanted && !tags.some((t) => wanted.has(t))) return;
		if (orphans && !orphans.has(i)) return;
		if (local && !local.has(i)) return;
		visible.add(i);
	});
	return visible;
}

const fold = (text: string) =>
	text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

// Sin distinguir mayúsculas ni acentos, sobre título y slug. Una consulta vacía
// no coincide con nada: quien llama decide qué hacer sin búsqueda.
export function matchesText(node: GraphNode, query: string): boolean {
	const needle = fold(query.trim());
	if (needle === "") return false;
	return fold(node[1]).includes(needle) || fold(node[0]).includes(needle);
}

const editDate = new Intl.DateTimeFormat("es-AR", {
	day: "numeric",
	month: "short",
	year: "numeric",
	timeZone: "America/Argentina/Buenos_Aires",
});

// "20 oct 2026". Este ICU de es-AR intercala "de" ("20 de oct de 2026") y otros
// agregan un punto tras el mes: se arma desde las partes para que sea igual.
export function formatEditDate(iso: string): string {
	const date = new Date(iso);
	if (Number.isNaN(date.getTime())) return "";
	const part = (type: string) =>
		editDate.formatToParts(date).find((p) => p.type === type)?.value ?? "";
	return `${part("day")} ${part("month").replace(/\.$/, "")} ${part("year")}`;
}

export type MapView = "grafo" | "lista";

// `?vista=` de /brain/mapa (D1). Cualquier otro valor, repetido o ausente
// queda sin fijar: decide el ancho de la pantalla.
export function parseMapView(value: unknown): MapView | undefined {
	return value === "grafo" || value === "lista" ? value : undefined;
}

// La capa del grafo se abre si se pidió o, sin pedido, en pantalla ancha (D1).
export function showsGraph(view: MapView | undefined, wide: boolean): boolean {
	return view === "grafo" || (view === undefined && wide);
}

type Point = { x: number; y: number };
type Size = { width: number; height: number };

const clamp = (value: number, min: number, max: number) =>
	Math.max(min, Math.min(value, max));

// Dónde va la tarjeta del popover (D6), en píxeles del contenedor: centrada
// debajo del nodo; si abajo no entra, arriba; y siempre adentro del contenedor,
// a `margin` del borde, aunque el nodo haya quedado fuera de la vista.
export function popoverPosition(
	anchor: Point,
	card: Size,
	box: Size,
	{ gap = 20, margin = 8 }: { gap?: number; margin?: number } = {},
): { left: number; top: number } {
	const below = anchor.y + gap;
	const above = anchor.y - gap - card.height;
	const top =
		below + card.height > box.height - margin && above >= margin
			? above
			: below;
	return {
		left: clamp(
			anchor.x - card.width / 2,
			margin,
			box.width - card.width - margin,
		),
		top: clamp(top, margin, box.height - card.height - margin),
	};
}
