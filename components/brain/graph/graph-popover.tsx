"use client";

// Popover de un nodo del mapa de conexiones (spec 26.4, D6): título, fecha de
// última edición y "Ver página". Nada más. Es una tarjeta propia y no un
// Popover de Radix: se ancla a un punto del canvas, no a un elemento.
// Va adentro del contenedor del grafo (`position: relative`), que es su
// `offsetParent`: `anchor()` da el punto del nodo en píxeles de ese contenedor
// y la tarjeta no se sale de él. Un clic adentro del contenedor lo resuelve el
// grafo (clickNode, clickStage); acá se cierra con Esc y con un clic afuera.
//
// Seguir al nodo no pasa por React: en cada cuadro (`subscribe`) se calcula la
// posición y se escribe `transform` por ref, sin re-render y sin leer el
// layout. Los tamaños se miden al abrir, al cambiar de nodo o de texto, y
// cuando un ResizeObserver avisa que cambió la tarjeta o el contenedor.

import Link from "next/link";
import { useCallback, useEffect, useLayoutEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { formatEditDate, popoverPosition } from "@/lib/brain/core/graph-view";

type Point = { x: number; y: number };
type Size = { width: number; height: number };

export function GraphPopover({
	title,
	updatedAt,
	href,
	anchor,
	subscribe,
	onClose,
}: {
	title: string;
	updatedAt: string;
	href: string;
	// Punto del nodo en el contenedor; null si el nodo ya no existe.
	anchor: () => Point | null;
	// Registra una función que corre después de cada cuadro; devuelve cómo soltarla.
	subscribe: (onFrame: () => void) => () => void;
	onClose: () => void;
}) {
	const cardRef = useRef<HTMLDivElement>(null);
	const linkRef = useRef<HTMLAnchorElement>(null);
	const sizes = useRef<{ card: Size; box: Size } | null>(null);
	const anchorRef = useRef(anchor);
	anchorRef.current = anchor;
	const subscribeRef = useRef(subscribe);
	subscribeRef.current = subscribe;
	const closeRef = useRef(onClose);
	closeRef.current = onClose;

	// Lee el layout: solo al abrir, al cambiar el contenido o con un resize.
	const measure = useCallback(() => {
		const card = cardRef.current;
		const box = card?.offsetParent;
		if (!card || !(box instanceof HTMLElement)) return;
		sizes.current = {
			card: { width: card.offsetWidth, height: card.offsetHeight },
			box: { width: box.clientWidth, height: box.clientHeight },
		};
	}, []);

	// Por cuadro: cuenta pura y una escritura de estilo.
	const place = useCallback(() => {
		const card = cardRef.current;
		if (!card || !sizes.current) return;
		const point = anchorRef.current();
		if (!point) {
			closeRef.current();
			return;
		}
		const { left, top } = popoverPosition(
			point,
			sizes.current.card,
			sizes.current.box,
		);
		card.style.transform = `translate(${Math.round(left)}px, ${Math.round(top)}px)`;
	}, []);

	// Antes del pintado: al abrir y al pasar a otro nodo la tarjeta ya aparece
	// en su lugar, con el texto nuevo.
	// biome-ignore lint/correctness/useExhaustiveDependencies: el contenido cambia el tamaño; `href` cambia con el nodo.
	useLayoutEffect(() => {
		measure();
		place();
	}, [title, updatedAt, href, measure, place]);

	useEffect(() => {
		const card = cardRef.current;
		const box = card?.offsetParent;
		const resized = new ResizeObserver(() => {
			measure();
			place();
		});
		if (card) resized.observe(card);
		if (box) resized.observe(box);
		const unsubscribe = subscribeRef.current(place);
		return () => {
			unsubscribe();
			resized.disconnect();
		};
	}, [measure, place]);

	// Al abrir, o al pasar a otro nodo, el foco va a "Ver página".
	// biome-ignore lint/correctness/useExhaustiveDependencies: `href` cambia con el nodo; ahí se vuelve a enfocar.
	useEffect(() => {
		linkRef.current?.focus({ preventScroll: true });
	}, [href]);

	useEffect(() => {
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key !== "Escape" || event.defaultPrevented) return;
			event.preventDefault();
			const box = cardRef.current?.offsetParent;
			closeRef.current();
			// Esc devuelve el foco al grafo, no al principio de la página.
			if (box instanceof HTMLElement) box.focus({ preventScroll: true });
		};
		const onPointerDown = (event: PointerEvent) => {
			const box = cardRef.current?.offsetParent;
			if (box instanceof Node && box.contains(event.target as Node)) return;
			closeRef.current();
		};
		document.addEventListener("keydown", onKeyDown);
		document.addEventListener("pointerdown", onPointerDown, true);
		return () => {
			document.removeEventListener("keydown", onKeyDown);
			document.removeEventListener("pointerdown", onPointerDown, true);
		};
	}, []);

	const date = formatEditDate(updatedAt);
	return (
		<div
			ref={cardRef}
			role="dialog"
			aria-label={title}
			className="absolute top-0 left-0 z-10 w-72 max-w-[calc(100%-1rem)] rounded-lg border bg-popover p-4 text-popover-foreground shadow-md"
		>
			<p className="break-words font-medium leading-snug">{title}</p>
			{date && (
				<p className="mt-1 text-muted-foreground text-sm">
					Última edición: <time dateTime={updatedAt}>{date}</time>
				</p>
			)}
			<Button asChild size="sm" className="mt-3">
				<Link ref={linkRef} href={href}>
					Ver página
				</Link>
			</Button>
		</div>
	);
}
