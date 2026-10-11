// app/[tenant]/settings/outreach/workflows-section.tsx
"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { resourceLabel, type WorkflowRow } from "@/lib/workflows/settings";
import { type Feedback, runRowAction } from "../usuarios/run-row-action";
import { saveWorkflow } from "./actions";
import { Message } from "./lists-section";

const INPUT =
	"h-9 w-24 rounded-md border border-input bg-transparent px-2 text-sm";

// Zona fija: el servidor y el navegador tienen husos distintos y el texto
// tiene que salir idéntico en ambos (si no, falla la hidratación).
const FALLBACK_TIMEZONE = "America/Argentina/Buenos_Aires";

const when = (value: string | null, timeZone: string) =>
	value
		? `Última corrida: ${new Intl.DateTimeFormat("es-AR", {
				dateStyle: "short",
				timeStyle: "short",
				timeZone,
			}).format(new Date(value))}`
		: "Todavía no corrió";

function Row({
	slug,
	row,
	timeZone,
}: {
	slug: string;
	row: WorkflowRow;
	timeZone: string;
}) {
	const router = useRouter();
	const [pending, startTransition] = useTransition();
	const [feedback, setFeedback] = useState<Feedback>(null);
	const [enabled, setEnabled] = useState(row.enabled);
	const [cadence, setCadence] = useState(String(row.cadenceMinutes));
	const [items, setItems] = useState(String(row.itemsPerTick));

	function save(nextEnabled: boolean) {
		setFeedback(null);
		startTransition(async () => {
			const out = await runRowAction({
				run: () =>
					saveWorkflow(slug, row.workflow, {
						enabled: nextEnabled,
						cadenceMinutes: Number(cadence),
						itemsPerTick: Number(items),
					}),
				confirm: () => true,
				refresh: () => router.refresh(),
			});
			// Si no se guardó, el estado vuelve a lo que la base tiene.
			setEnabled(out.failed ? row.enabled : nextEnabled);
			setFeedback(
				out.feedback ?? (out.failed ? null : { ok: true, text: "Guardado." }),
			);
		});
	}

	return (
		<li className="space-y-2 px-4 py-3">
			<div className="flex flex-wrap items-center gap-3">
				<div className="min-w-0 flex-1">
					<div className="font-mono text-sm">{row.workflow}</div>
					<div className="text-muted-foreground text-xs">
						{when(row.lastRunAt, timeZone)} · usa{" "}
						{row.resources.map(resourceLabel).join(" y ")}
					</div>
				</div>
				<Message feedback={feedback} />
				<Button
					aria-label={`${enabled ? "Apagar" : "Encender"} ${row.workflow}`}
					disabled={pending}
					onClick={() => save(!enabled)}
					size="sm"
					type="button"
					variant={enabled ? "outline" : "default"}
				>
					{enabled ? "Apagar" : "Encender"}
				</Button>
			</div>
			<div className="flex flex-wrap items-end gap-3 text-sm">
				<label className="space-y-1">
					<span className="block text-xs">Cada cuántos minutos</span>
					<input
						className={INPUT}
						disabled={pending}
						max={10080}
						min={5}
						onChange={(event) => setCadence(event.target.value)}
						type="number"
						value={cadence}
					/>
				</label>
				<label className="space-y-1">
					<span className="block text-xs">
						Por pasada (hasta {row.maxItemsPerTick})
					</span>
					<input
						className={INPUT}
						disabled={pending}
						max={row.maxItemsPerTick}
						min={1}
						onChange={(event) => setItems(event.target.value)}
						type="number"
						value={items}
					/>
				</label>
				<Button
					aria-label={`Guardar ${row.workflow}`}
					disabled={pending}
					onClick={() => save(enabled)}
					size="sm"
					type="button"
					variant="outline"
				>
					Guardar
				</Button>
			</div>
			{enabled && row.unfunded.length > 0 ? (
				<p className="text-destructive text-xs">
					No va a correr: INNOV.AS todavía no cargó presupuesto de{" "}
					{row.unfunded.map(resourceLabel).join(" ni de ")}.
				</p>
			) : null}
		</li>
	);
}

export function WorkflowsSection({
	slug,
	workflows,
	timezone = FALLBACK_TIMEZONE,
}: {
	slug: string;
	workflows: WorkflowRow[];
	/** La zona horaria de la empresa; sin ella, la de Buenos Aires. */
	timezone?: string;
}) {
	return (
		<div className="space-y-3">
			<p className="text-muted-foreground text-sm">
				Son los procesos que corren solos. Cada uno gasta de tu presupuesto
				diario; apagado no gasta nada.
			</p>
			<ul className="divide-y rounded-lg border bg-card">
				{workflows.map((row) => (
					<Row key={row.workflow} row={row} slug={slug} timeZone={timezone} />
				))}
			</ul>
		</div>
	);
}
