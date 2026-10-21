"use client";

// Vista Grafo de /brain/mapa (spec 26.4, D1 y D2): una capa a pantalla completa
// sobre la Lista, que el servidor renderiza siempre como base. La capa se monta
// con ?vista=grafo o, sin ?vista, solo en pantalla ancha; en celular entra la
// lista y la capa nunca se monta. El ancho se mira en el cliente, no en el
// servidor.

import dynamic from "next/dynamic";
import Link from "next/link";
import { useEffect, useRef, useSyncExternalStore } from "react";
import { Button } from "@/components/ui/button";
import { type MapView, showsGraph } from "@/lib/brain/core/graph-view";

// Sigma y graphology pesan: los paga solo quien abre el grafo (D3).
const BrainGraph = dynamic(
	() => import("./brain-graph").then((module) => module.BrainGraph),
	{
		ssr: false,
		loading: () => (
			<p
				role="status"
				className="flex h-full items-center justify-center text-muted-foreground"
			>
				Cargando el mapa…
			</p>
		),
	},
);

const WIDE = "(min-width: 768px)";

function subscribeWide(onChange: () => void) {
	const query = window.matchMedia(WIDE);
	query.addEventListener("change", onChange);
	return () => query.removeEventListener("change", onChange);
}

export function MapaVista({
	tenantSlug,
	vista,
}: {
	tenantSlug: string;
	vista?: MapView;
}) {
	// En el servidor y al hidratar vale false: la lista es la base y en celular
	// no hay salto.
	const wide = useSyncExternalStore(
		subscribeWide,
		() => window.matchMedia(WIDE).matches,
		() => false,
	);
	const open = showsGraph(vista, wide);
	if (!open) return null;
	return <GraphLayer tenantSlug={tenantSlug} />;
}

function GraphLayer({ tenantSlug }: { tenantSlug: string }) {
	const layerRef = useRef<HTMLElement>(null);

	// Con la capa abierta, lo de atrás no scrollea ni recibe foco; al cerrar o
	// desmontar vuelve como estaba. Si el foco quedó afuera (el "Ver grafo" que
	// abrió la capa ahora es inerte y el foco cayó a <body>), pasa a la vista
	// actual de la capa: desde ahí Tab sigue a "Lista".
	useEffect(() => {
		const layer = layerRef.current;
		if (!layer) return;
		const overflow = document.body.style.overflow;
		document.body.style.overflow = "hidden";
		const restoreFocus = inertBehind(layer);
		if (!layer.contains(document.activeElement))
			layer
				.querySelector<HTMLElement>('[aria-current="page"]')
				?.focus({ preventScroll: true });
		return () => {
			document.body.style.overflow = overflow;
			restoreFocus();
		};
	}, []);

	const mapa = `/${tenantSlug}/brain/mapa`;
	return (
		<section
			ref={layerRef}
			aria-label="Mapa de conexiones"
			className="fixed inset-0 z-50 flex flex-col bg-background"
		>
			<div className="flex h-14 shrink-0 items-center gap-3 border-b px-4">
				<Button asChild variant="ghost" size="sm">
					<Link href={`/${tenantSlug}/brain`}>← Brain</Link>
				</Button>
				<nav aria-label="Vista del mapa" className="flex gap-1">
					<Button asChild variant="secondary" size="sm">
						<Link href={`${mapa}?vista=grafo`} aria-current="page">
							Grafo
						</Link>
					</Button>
					<Button asChild variant="ghost" size="sm">
						<Link href={`${mapa}?vista=lista`}>Lista</Link>
					</Button>
				</nav>
			</div>
			<div className="relative min-h-0 flex-1">
				<BrainGraph tenantSlug={tenantSlug} />
			</div>
		</section>
	);
}

// Vuelve inertes los hermanos de la capa y de cada ancestro, hasta el hijo
// directo de <body>: el encabezado, el árbol y la lista quedan fuera del Tab y
// del lector de pantalla. Lo que cuelga directo de <body> (diálogos, avisos,
// el anunciador de rutas) no se toca. Devuelve cómo deshacerlo.
function inertBehind(layer: HTMLElement): () => void {
	const touched: HTMLElement[] = [];
	for (
		let node: HTMLElement = layer;
		node.parentElement && node.parentElement !== document.body;
		node = node.parentElement
	) {
		for (const sibling of node.parentElement.children) {
			if (sibling === node || !(sibling instanceof HTMLElement)) continue;
			if (sibling.inert) continue;
			sibling.inert = true;
			touched.push(sibling);
		}
	}
	return () => {
		for (const element of touched) element.inert = false;
	};
}
