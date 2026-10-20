"use client";

// Mapa de conexiones del brain dibujado con Sigma (spec 26.4: D3, D4, D5, D11,
// D16). Pide el payload compacto, arma el grafo con graphology, corre
// ForceAtlas2 en un worker y dibuja con WebGL. Ocupa el alto y el ancho de su
// contenedor. Quien lo monte lo carga con next/dynamic y ssr: false.

import Graph from "graphology";
import { inferSettings } from "graphology-layout-forceatlas2";
import FA2Layout from "graphology-layout-forceatlas2/worker";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import Sigma, { DEFAULT_STYLES } from "sigma";
import { Button } from "@/components/ui/button";
import type { GraphPayload } from "@/lib/brain/core/graph";
import {
	categoryColors,
	fadeColor,
	type GraphNodeAttributes,
	layoutBudgetMs,
	toGraphData,
} from "@/lib/brain/core/graph-view";
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

export function BrainGraph({ tenantSlug }: { tenantSlug: string }) {
	const [state, setState] = useState<LoadState>({ kind: "loading" });
	const [attempt, setAttempt] = useState(0);
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
		graph.import(toGraphData(payload), true);

		let theme = readGraphTheme(container);
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
		paint();

		let sigma: Sigma<NodeAttributes, EdgeAttributes>;
		try {
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
				styles: {
					nodes: [
						DEFAULT_STYLES.nodes,
						{
							labelColor: () => theme.label,
							backdropColor: () => theme.background,
						},
					],
					edges: DEFAULT_STYLES.edges,
				},
			});
		} catch (error) {
			console.error("brain-graph: Sigma no pudo arrancar", error);
			setState({ kind: "error" });
			return;
		}
		sigmaRef.current = sigma;
		graphRef.current = graph;

		const stopWatching = watchColorScheme(() => {
			theme = readGraphTheme(container);
			paint();
			sigma.refresh();
		});

		// Layout acotado en tiempo y en pausa mientras la persona mueve el mapa
		// (spec §2.1 a: con la CPU 4× más lenta, corriendo baja a 13 fps).
		const layout = new FA2Layout(graph, { settings: inferSettings(graph) });
		const budget = layoutBudgetMs(graph.order);
		let spent = 0;
		let since: number | null = null;
		let pointerDown = false;
		let stopTimer: ReturnType<typeof setTimeout> | undefined;
		let resumeTimer: ReturnType<typeof setTimeout> | undefined;

		const pause = () => {
			if (since === null) return;
			layout.stop();
			spent += performance.now() - since;
			since = null;
			clearTimeout(stopTimer);
		};
		// Se cumplió el tope: se corta para siempre y se libera el worker.
		const finish = () => {
			pause();
			spent = budget;
			layout.kill();
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

	return (
		<div className="relative h-full w-full bg-background">
			<div ref={containerRef} className="absolute inset-0" />
			{state.kind === "loading" && (
				<Overlay>
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
				<Overlay>
					<p>No pudimos cargar el mapa</p>
					<Button variant="outline" onClick={() => setAttempt((n) => n + 1)}>
						Reintentar
					</Button>
				</Overlay>
			)}
		</div>
	);
}

function Overlay({ children }: { children: React.ReactNode }) {
	return (
		<div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-center">
			{children}
		</div>
	);
}
