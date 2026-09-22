"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import type {
	ContactFilters,
	ContactRow,
} from "@/lib/outreach/contactos-query";
import {
	type HistoryEntry,
	toHistoryEntries,
} from "@/lib/outreach/historial-query";
import { OUTREACH_STAGES, STAGE_LABELS } from "@/lib/outreach/stage";
import { createBrowserSupabase } from "@/lib/supabase/browser";

const fecha = (value: string | null) =>
	value ? new Date(value).toLocaleDateString("es-AR") : "—";

// Mismos tres carriles de decideIcp (lib/outreach/icp.ts). Colores tomados de
// los tokens ya definidos en globals.css, no uno nuevo por pantalla.
const LANE_LABELS: Record<string, string> = {
	calificado: "Calificado",
	para_revisar: "Para revisar",
	descartado: "Descartado",
};

const LANE_BADGE_CLASSES: Record<string, string> = {
	calificado: "bg-success/10 text-success",
	para_revisar: "bg-warn/10 text-warn",
	descartado: "bg-muted text-muted-foreground",
};

export function ContactosClient({
	slug,
	filters,
	rows,
	truncated,
}: {
	slug: string;
	filters: ContactFilters;
	rows: ContactRow[];
	truncated: boolean;
}) {
	const router = useRouter();
	const [q, setQ] = useState(filters.q ?? "");

	// Los filtros viven en la URL, no en el estado: así el link del embudo
	// funciona, el botón de atrás hace lo que se espera, y se puede compartir
	// una búsqueda.
	const setFilter = useCallback(
		(key: string, value: string | null) => {
			const params = new URLSearchParams();
			const current: Record<string, string | null> = {
				etapa: filters.etapa,
				ejecutor: filters.ejecutor,
				vector: filters.vector,
				hook: filters.hook,
				lane: filters.lane,
				q: filters.q,
			};
			current[key] = value;
			for (const [k, v] of Object.entries(current)) {
				if (v) params.set(k, v);
			}
			const query = params.toString();
			router.push(`/${slug}/contactos${query ? `?${query}` : ""}`);
		},
		[filters, router, slug],
	);

	// La búsqueda espera a que dejes de tipear: sin esto cada tecla sería una
	// navegación y una consulta.
	useEffect(() => {
		if (q === (filters.q ?? "")) return;
		const id = setTimeout(() => setFilter("q", q.trim() || null), 400);
		return () => clearTimeout(id);
	}, [q, filters.q, setFilter]);

	const hayFiltros =
		filters.etapa ||
		filters.ejecutor ||
		filters.vector ||
		filters.hook ||
		filters.lane ||
		filters.q;

	return (
		<div className="flex flex-col gap-6">
			<header className="flex flex-col gap-1">
				<h1 className="font-semibold text-2xl tracking-display">Contactos</h1>
				<p className="text-muted-foreground text-sm">
					{rows.length === 0
						? "Ningún contacto para estos filtros."
						: `${rows.length}${truncated ? "+" : ""} ${rows.length === 1 ? "contacto" : "contactos"}.`}
				</p>
			</header>

			<div className="flex flex-col gap-3 sm:flex-row sm:items-center">
				<Input
					className="h-11 sm:max-w-xs"
					placeholder="Buscar por nombre, empresa o mail"
					value={q}
					onChange={(event) => setQ(event.target.value)}
				/>
				<select
					className="h-11 rounded-md border bg-background px-3 text-sm sm:max-w-xs"
					value={filters.etapa ?? ""}
					onChange={(event) => setFilter("etapa", event.target.value || null)}
				>
					<option value="">Todas las etapas</option>
					{OUTREACH_STAGES.map((stage) => (
						<option key={stage} value={stage}>
							{STAGE_LABELS[stage]}
						</option>
					))}
				</select>
				<select
					className="h-11 rounded-md border bg-background px-3 text-sm sm:max-w-xs"
					value={filters.lane ?? ""}
					onChange={(event) => setFilter("lane", event.target.value || null)}
				>
					<option value="">Todos los carriles</option>
					{Object.entries(LANE_LABELS).map(([lane, label]) => (
						<option key={lane} value={lane}>
							{label}
						</option>
					))}
				</select>
				{hayFiltros ? (
					<button
						type="button"
						className="h-11 text-muted-foreground text-sm underline underline-offset-4"
						onClick={() => router.push(`/${slug}/contactos`)}
					>
						Limpiar filtros
					</button>
				) : null}
			</div>

			{truncated ? (
				<p className="text-muted-foreground text-xs">
					Se muestran los primeros contactos por fecha de último toque. Afiná la
					búsqueda para ver el resto.
				</p>
			) : null}

			{rows.length === 0 ? (
				<Card className="p-6">
					<p className="text-muted-foreground text-sm">
						{hayFiltros
							? "Ningún contacto coincide con estos filtros."
							: "Todavía no hay contactos. Importalos desde el chat."}
					</p>
				</Card>
			) : (
				<Card className="divide-y">
					{rows.map((row) => (
						<ContactCard key={row.id} row={row} />
					))}
				</Card>
			)}
		</div>
	);
}

function ContactCard({ row }: { row: ContactRow }) {
	const [abierto, setAbierto] = useState(false);

	return (
		<div>
			<button
				type="button"
				className="flex min-h-11 w-full items-center gap-3 p-4 text-left hover:bg-muted/50"
				onClick={() => setAbierto((open) => !open)}
				aria-expanded={abierto}
			>
				<div className="min-w-0 flex-1">
					<p className="truncate font-medium text-sm">
						{row.name ?? row.email ?? row.contactKey}
					</p>
					<p className="truncate text-muted-foreground text-xs">
						{row.company ?? row.accountDomain ?? "Sin empresa"}
						{row.ownerSlug ? ` · ${row.ownerSlug}` : ""}
					</p>
				</div>
				<div className="shrink-0 text-right">
					<p className="text-xs">
						{STAGE_LABELS[row.stage as keyof typeof STAGE_LABELS] ?? row.stage}
					</p>
					{row.icpLane ? (
						<span
							className={`mt-1 inline-block rounded-full px-2 py-0.5 text-xs ${
								LANE_BADGE_CLASSES[row.icpLane] ?? "bg-muted text-muted-foreground"
							}`}
						>
							{LANE_LABELS[row.icpLane] ?? row.icpLane}
							{row.icpScore !== null ? ` · ${row.icpScore}` : ""}
						</span>
					) : null}
					<p className="text-muted-foreground text-xs tabular-nums">
						{row.touches} {row.touches === 1 ? "toque" : "toques"} ·{" "}
						{fecha(row.lastTouchAt)}
					</p>
				</div>
				<span aria-hidden="true" className="shrink-0 text-muted-foreground">
					{abierto ? "−" : "+"}
				</span>
			</button>
			{abierto ? <Historial contactKey={row.contactKey} /> : null}
		</div>
	);
}

function Historial({ contactKey }: { contactKey: string }) {
	const [entries, setEntries] = useState<HistoryEntry[] | null>(null);
	const [error, setError] = useState(false);

	useEffect(() => {
		let cancelled = false;
		// Con el cliente del navegador (anon + JWT): la RLS events_select es la
		// que decide qué eventos llegan. Nunca service role acá.
		createBrowserSupabase()
			.from("events")
			.select("id, type, summary, payload, created_at")
			.eq("contact_key", contactKey)
			.order("created_at", { ascending: false })
			.limit(100)
			.then(({ data, error: queryError }) => {
				if (cancelled) return;
				if (queryError) {
					setError(true);
					return;
				}
				setEntries(toHistoryEntries(data ?? []));
			});
		return () => {
			cancelled = true;
		};
	}, [contactKey]);

	if (error) {
		return (
			<p className="px-4 pb-4 text-destructive text-sm">
				No se pudo leer el historial.
			</p>
		);
	}

	if (entries === null) {
		return (
			<p className="px-4 pb-4 text-muted-foreground text-sm">
				Cargando el historial…
			</p>
		);
	}

	if (entries.length === 0) {
		return (
			<p className="px-4 pb-4 text-muted-foreground text-sm">
				Todavía no pasó nada con este contacto.
			</p>
		);
	}

	return (
		<ol className="flex flex-col gap-2 border-t bg-muted/30 px-4 py-3">
			{entries.map((entry) => (
				<li key={entry.id} className="flex gap-3 text-sm">
					<span className="w-24 shrink-0 text-muted-foreground text-xs tabular-nums">
						{fecha(entry.createdAt)}
					</span>
					<span className="min-w-0">
						<span
							className={
								entry.problema ? "font-medium text-destructive" : "font-medium"
							}
						>
							{entry.label}
						</span>
						{entry.detail ? (
							<span className="text-muted-foreground"> — {entry.detail}</span>
						) : null}
					</span>
				</li>
			))}
		</ol>
	);
}
