"use client";

// Mapa de conexiones del brain dibujado con Sigma (spec 26.4: D3, D4, D5, D6,
// D7, D8, D11, D16). Pide el payload compacto, arma el grafo con graphology, corre
// ForceAtlas2 en un worker y dibuja con WebGL. Un clic en un nodo abre su
// popover; pasar el mouse resalta al nodo y sus vecinos. Ocupa el alto y el
// ancho de su contenedor. Quien lo monte lo carga con next/dynamic y ssr: false.

import Graph from "graphology";
import { inferSettings } from "graphology-layout-forceatlas2";
import FA2Layout from "graphology-layout-forceatlas2/worker";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import Sigma, { DEFAULT_STYLES } from "sigma";
import { Button } from "@/components/ui/button";
import { pageHref } from "@/lib/brain/core/editor/slug";
import type { GraphPayload } from "@/lib/brain/core/graph";
import {
	categoryColors,
	fadeColor,
	type GraphNodeAttributes,
	layoutBudgetMs,
	toGraphData,
	truncationNotice,
} from "@/lib/brain/core/graph-view";
import { GraphPopover } from "./graph-popover";
import { readGraphTheme, watchColorScheme } from "./graph-theme";

type NodeAttributes = GraphNodeAttributes & { color?: string };
type EdgeAttributes = { color?: string };
type BrainGraphData = Graph<NodeAttributes, EdgeAttributes>;

type LoadState =
	| { kind: "loading" }
	| { kind: "empty" }
	| { kind: "error" }
	| { kind: "ready"; payload: GraphPayload };

// Cuánto se mezcla una archivada con el fondo (D5).
const ARCHIVED_FADE = 0.65;
// Tras soltar el mouse o la última rueda, cuánto espera el layout para seguir.
const RESUME_AFTER_MS = 400;
// Con el mouse sobre un nodo, cuánto se mezcla el resto con el fondo (D7).
const HOVER_FADE = 0.8;
// Y cuánto se acerca al fondo el color de etiqueta en las aristas resaltadas.
const LIT_EDGE_FADE = 0.45;

export function BrainGraph({ tenantSlug }: { tenantSlug: string }) {
	const [state, setState] = useState<LoadState>({ kind: "loading" });
	const [attempt, setAttempt] = useState(0);
	// Nodo con el popover abierto (D6).
	const [selected, setSelected] = useState<string | null>(null);
	const containerRef = useRef<HTMLDivElement>(null);
	// Instancias vivas, para lo que se monte encima (popover, filtros).
	const sigmaRef = useRef<Sigma<NodeAttributes, EdgeAttributes> | null>(null);
	const graphRef = useRef<BrainGraphData | null>(null);

	// biome-ignore lint/correctness/useExhaustiveDependencies: `attempt` no se lee; cambia con "Reintentar" para volver a pedir.
	useEffect(() => {
		const controller = new AbortController();
		setState({ kind: "loading" });
		(async () => {
			try {
				const response = await fetch(`/${tenantSlug}/brain/mapa/datos`, {
					cache: "no-store",
					signal: controller.signal,
				});
				if (!response.ok) throw new Error(`HTTP ${response.status}`);
				const payload = (await response.json()) as GraphPayload;
				if (controller.signal.aborted) return;
				setState(
					payload.nodes.length === 0
						? { kind: "empty" }
						: { kind: "ready", payload },
				);
			} catch (error) {
				if (controller.signal.aborted) return;
				console.error("brain-graph: no pude cargar el mapa", error);
				setState({ kind: "error" });
			}
		})();
		return () => controller.abort();
	}, [tenantSlug, attempt]);

	const payload = state.kind === "ready" ? state.payload : null;

	useEffect(() => {
		const container = containerRef.current;
		if (!payload || !container) return;

		const graph: BrainGraphData = new Graph({
			type: "undirected",
			multi: false,
			allowSelfLoops: false,
		});

		let theme = readGraphTheme(container);
		// Colores del resaltado (D7). Los atenuados se memorizan por color (son
		// unos pocos) para no volver a parsear en cada nodo; cambian con el tema.
		let dimmed = new Map<string, string>();
		let litEdge = fadeColor(theme.label, theme.background, LIT_EDGE_FADE);
		const dim = (color: string) => {
			let out = dimmed.get(color);
			if (out === undefined) {
				out = fadeColor(color, theme.background, HOVER_FADE);
				dimmed.set(color, out);
			}
			return out;
		};
		const paint = () => {
			const colors = categoryColors(theme.palette, payload.categories.length);
			graph.updateEachNodeAttributes(
				(_, attributes) => {
					const base = colors[attributes.category] ?? theme.label;
					return {
						...attributes,
						color: attributes.archived
							? fadeColor(base, theme.background, ARCHIVED_FADE)
							: base,
					};
				},
				{ attributes: ["color"] },
			);
			graph.updateEachEdgeAttributes(
				(_, attributes) => ({ ...attributes, color: theme.edge }),
				{ attributes: ["color"] },
			);
		};

		// Un payload mal formado o un WebGL que no arranca terminan en el aviso con
		// "Reintentar", no en un subárbol roto.
		let sigma: Sigma<NodeAttributes, EdgeAttributes>;
		try {
			graph.import(toGraphData(payload), true);
			paint();
			sigma = new Sigma(graph, container, {
				settings: {
					// Sin esto, en Sigma 4 el tamaño es en coordenadas del grafo y los
					// nodos se ven diminutos (spec §2.1).
					itemSizesReference: "screen",
					// A poco zoom solo pasan la vara los nodos grandes.
					labelRenderedSizeThreshold: 12,
					enableCameraRotation: false,
					enableCameraMouseRotation: false,
					sharedGestureWheelMessage: "Usá Ctrl + rueda para hacer zoom",
					sharedGestureAppleWheelMessage: "Usá ⌘ + rueda para hacer zoom",
					sharedGestureTouchMessage: "Usá dos dedos para mover el mapa",
				},
				// Resaltado con el estado de Sigma 4 (isHighlighted) y reglas de
				// estilo, no con nodeReducer/edgeReducer: en 4.0.3 un reducer
				// apaga el refresco en el lugar (refreshNodeState) y copia el
				// objeto de cada nodo en cada actualización, también mientras
				// corre el layout. Con estados, Sigma reescribe su caché sin
				// asignar.
				styles: {
					nodes: [
						DEFAULT_STYLES.nodes,
						{
							labelColor: () => theme.label,
							backdropColor: () => theme.background,
						},
						{
							when: (_, node, graphState) =>
								graphState.hasHighlighted && !node.isHighlighted,
							// biome-ignore lint/suspicious/noThenProperty: así escribe Sigma 4 una regla condicional.
							then: {
								color: (attributes) => dim(attributes.color ?? theme.label),
								labelVisibility: "hidden",
							},
						},
					],
					edges: [
						DEFAULT_STYLES.edges,
						// D7 dice "atenúa el resto"; para las aristas se eligió
						// ocultar las que no tocan al nodo, por legibilidad: con
						// cientos de aristas tenues de fondo, las del vecindario no
						// se distinguen.
						{
							when: (_, edge, graphState) =>
								graphState.hasHighlighted && !edge.isHighlighted,
							// biome-ignore lint/suspicious/noThenProperty: así escribe Sigma 4 una regla condicional.
							then: { visibility: "hidden" },
						},
						{
							whenState: "isHighlighted",
							// biome-ignore lint/suspicious/noThenProperty: así escribe Sigma 4 una regla condicional.
							then: { color: () => litEdge },
						},
					],
				},
			});
		} catch (error) {
			console.error("brain-graph: no pude armar el mapa", error);
			// Sigma pudo haber agregado sus canvas antes de fallar: sin esto,
			// "Reintentar" apila los nuevos sobre los viejos.
			container.replaceChildren();
			setState({ kind: "error" });
			return;
		}
		sigmaRef.current = sigma;
		graphRef.current = graph;

		const stopWatching = watchColorScheme(() => {
			theme = readGraphTheme(container);
			dimmed = new Map();
			litEdge = fadeColor(theme.label, theme.background, LIT_EDGE_FADE);
			paint();
			sigma.refresh();
		});

		// Hover (D7): el nodo y sus vecinos quedan resaltados y el resto se
		// atenúa. Vecinos con graph.neighbors: O(grado), sin recorrer el grafo.
		let litNodes: string[] = [];
		let litEdges: string[] = [];
		const unlight = () => {
			if (litNodes.length > 0)
				sigma.setNodesState(litNodes, { isHighlighted: false });
			if (litEdges.length > 0)
				sigma.setEdgesState(litEdges, { isHighlighted: false });
			litNodes = [];
			litEdges = [];
		};
		const light = ({ node }: { node: string }) => {
			unlight();
			litNodes = graph.neighbors(node);
			litNodes.push(node);
			litEdges = graph.edges(node);
			sigma.setNodesState(litNodes, { isHighlighted: true });
			sigma.setEdgesState(litEdges, { isHighlighted: true });
		};
		const select = ({ node }: { node: string }) => setSelected(node);
		const deselect = () => setSelected(null);
		sigma.on("enterNode", light);
		sigma.on("leaveNode", unlight);
		sigma.on("clickNode", select);
		sigma.on("clickStage", deselect);

		// Layout acotado en tiempo y en pausa mientras la persona mueve el mapa
		// (spec §2.1 a: con la CPU 4× más lenta, corriendo baja a 13 fps).
		const layout = new FA2Layout(graph, { settings: inferSettings(graph) });
		const budget = layoutBudgetMs(graph.order);
		let spent = 0;
		let since: number | null = null;
		let pointerDown = false;
		let stopTimer: ReturnType<typeof setTimeout> | undefined;
		let resumeTimer: ReturnType<typeof setTimeout> | undefined;

		// Se cumplió el tope: se corta para siempre y se libera el worker.
		const finish = () => {
			if (since !== null) layout.stop();
			since = null;
			clearTimeout(stopTimer);
			spent = budget;
			layout.kill();
		};
		const pause = () => {
			if (since === null) return;
			layout.stop();
			spent += performance.now() - since;
			since = null;
			clearTimeout(stopTimer);
			if (spent >= budget) finish();
		};
		const run = () => {
			if (since !== null || spent >= budget) return;
			since = performance.now();
			layout.start();
			stopTimer = setTimeout(finish, budget - spent);
		};
		const interact = () => {
			pause();
			clearTimeout(resumeTimer);
			if (!pointerDown) resumeTimer = setTimeout(run, RESUME_AFTER_MS);
		};
		const press = () => {
			pointerDown = true;
			interact();
		};
		const release = () => {
			pointerDown = false;
			interact();
		};

		const mouse = sigma.getMouseCaptor();
		const touch = sigma.getTouchCaptor();
		mouse.on("mousedown", press);
		mouse.on("mouseup", release);
		mouse.on("wheel", interact);
		touch.on("touchdown", press);
		touch.on("touchup", release);
		run();

		return () => {
			clearTimeout(stopTimer);
			clearTimeout(resumeTimer);
			stopWatching();
			sigma.off("enterNode", light);
			sigma.off("leaveNode", unlight);
			sigma.off("clickNode", select);
			sigma.off("clickStage", deselect);
			setSelected(null);
			mouse.off("mousedown", press);
			mouse.off("mouseup", release);
			mouse.off("wheel", interact);
			touch.off("touchdown", press);
			touch.off("touchup", release);
			layout.kill();
			sigma.kill();
			sigmaRef.current = null;
			graphRef.current = null;
		};
	}, [payload]);

	const sigma = sigmaRef.current;
	const graph = graphRef.current;
	const popoverFor = selected && graph?.hasNode(selected) ? selected : null;

	return (
		// tabIndex -1: el popover devuelve acá el foco cuando se cierra con Esc,
		// así que el nombre accesible va acá (group) y no en el canvas: un
		// segundo nombre igual en un hijo role="img" se anunciaría dos veces. El
		// canvas no se recorre con teclado (D12): la alternativa es la Lista.
		// biome-ignore lint/a11y/useSemanticElements: <fieldset> es de formularios; esto es un grupo con nombre.
		<div
			role="group"
			aria-label="Mapa de conexiones del brain"
			tabIndex={-1}
			className="relative h-full w-full bg-background outline-none focus-visible:outline-2 focus-visible:outline-ring focus-visible:-outline-offset-2"
		>
			<div ref={containerRef} className="absolute inset-0" />
			{payload?.truncated && (
				// Arriba a la izquierda y sin capturar el mouse: no tapa el centro
				// ni frena el paneo. Antes que el popover, que va encima.
				<p
					role="status"
					className="pointer-events-none absolute top-3 left-3 max-w-[calc(100%-1.5rem)] rounded-md border bg-background/90 px-3 py-1.5 text-xs text-muted-foreground shadow-sm"
				>
					{truncationNotice(payload.nodes.length, payload.total)}
				</p>
			)}
			{sigma && graph && payload && popoverFor && (
				<NodePopover
					sigma={sigma}
					graph={graph}
					node={popoverFor}
					title={graph.getNodeAttribute(popoverFor, "label")}
					updatedAt={
						payload.nodes[graph.getNodeAttribute(popoverFor, "index")]?.[4] ??
						""
					}
					href={pageHref(tenantSlug, popoverFor)}
					onClose={() => setSelected(null)}
				/>
			)}
			{state.kind === "loading" && (
				<Overlay role="status">
					<p className="text-muted-foreground">Cargando el mapa…</p>
				</Overlay>
			)}
			{state.kind === "empty" && (
				<Overlay>
					<p>Todavía no hay páginas</p>
					<Link
						href={`/${tenantSlug}/brain`}
						className="text-sm text-muted-foreground underline underline-offset-4"
					>
						Volver al brain
					</Link>
				</Overlay>
			)}
			{state.kind === "error" && (
				<Overlay role="alert">
					<p>No pudimos cargar el mapa</p>
					<Button variant="outline" onClick={() => setAttempt((n) => n + 1)}>
						Reintentar
					</Button>
				</Overlay>
			)}
		</div>
	);
}

// Une el popover con Sigma. En React vive solo qué nodo está abierto: seguirlo
// en pantalla (cámara que se mueve o layout que lo corre) lo hace el popover
// por ref después de cada cuadro (`afterRender`), sin re-render. Si el nodo
// deja de existir, `anchor` da null y el popover se cierra.
function NodePopover({
	sigma,
	graph,
	node,
	...card
}: {
	sigma: Sigma<NodeAttributes, EdgeAttributes>;
	graph: BrainGraphData;
	node: string;
	title: string;
	updatedAt: string;
	href: string;
	onClose: () => void;
}) {
	return (
		<GraphPopover
			{...card}
			anchor={() =>
				graph.hasNode(node)
					? sigma.graphToViewport(graph.getNodeAttributes(node))
					: null
			}
			subscribe={(onFrame) => {
				sigma.on("afterRender", onFrame);
				return () => {
					sigma.off("afterRender", onFrame);
				};
			}}
		/>
	);
}

function Overlay({
	role,
	children,
}: {
	role?: "status" | "alert";
	children: React.ReactNode;
}) {
	return (
		<div
			role={role}
			className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-center"
		>
			{children}
		</div>
	);
}
