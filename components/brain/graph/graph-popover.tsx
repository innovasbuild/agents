"use client";

// Popover de un nodo del mapa de conexiones (spec 26.4, D6): título, fecha de
// última edición y "Ver página". Nada más. Es una tarjeta propia y no un
// Popover de Radix: se ancla a un punto del canvas, no a un elemento.
// Va adentro del contenedor del grafo (`position: relative`), que es su
// `offsetParent`: (x, y) son píxeles de ese contenedor y la tarjeta no se sale
// de él. Un clic adentro del contenedor lo resuelve el grafo (clickNode,
// clickStage); acá se cierra con Esc y con un clic afuera del contenedor.

import Link from "next/link";
import { useEffect, useLayoutEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { formatEditDate, popoverPosition } from "@/lib/brain/core/graph-view";

export function GraphPopover({
	title,
	updatedAt,
	href,
	x,
	y,
	onClose,
}: {
	title: string;
	updatedAt: string;
	href: string;
	x: number;
	y: number;
	onClose: () => void;
}) {
	const cardRef = useRef<HTMLDivElement>(null);
	const linkRef = useRef<HTMLAnchorElement>(null);
	const closeRef = useRef(onClose);
	closeRef.current = onClose;

	// Se reubica sin esperar al pintado; el contenedor manda el tope.
	// biome-ignore lint/correctness/useExhaustiveDependencies: `title` cambia el alto de la tarjeta.
	useLayoutEffect(() => {
		const card = cardRef.current;
		const box = card?.offsetParent;
		if (!card || !(box instanceof HTMLElement)) return;
		const { left, top } = popoverPosition(
			{ x, y },
			{ width: card.offsetWidth, height: card.offsetHeight },
			{ width: box.clientWidth, height: box.clientHeight },
		);
		card.style.transform = `translate(${Math.round(left)}px, ${Math.round(top)}px)`;
	}, [x, y, title]);

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
