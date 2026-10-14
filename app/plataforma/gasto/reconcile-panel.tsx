"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import type { ReconcileLine } from "@/lib/usage/reconcile";
import { type Period, usd } from "@/lib/usage/report";
import { type ReconcileResult, reconcileSpend } from "./actions";

const PERIODS: { key: Period; label: string }[] = [
	{ key: "actual", label: "Mes en curso (hasta ayer)" },
	{ key: "anterior", label: "Mes anterior" },
];

const pct = (value: number | null) =>
	value === null
		? "—"
		: `${(value * 100).toLocaleString("es-AR", { maximumFractionDigits: 1 })} %`;

function LineRow({ line }: { line: ReconcileLine }) {
	return (
		<tr className={line.flagged ? "text-destructive" : undefined}>
			<td className="px-4 py-2">
				{line.label}
				{line.flagged ? " · revisar" : ""}
			</td>
			<td className="px-4 py-2 text-right tabular-nums">{usd(line.ledger)}</td>
			<td className="px-4 py-2 text-right tabular-nums">{usd(line.gateway)}</td>
			<td className="px-4 py-2 text-right tabular-nums">{usd(line.diff)}</td>
			<td className="px-4 py-2 text-right tabular-nums">
				{/* Sin libro de por medio, el porcentaje siempre sería -100 %. */}
				{line.kind === "empresa" ? pct(line.diffPct) : "—"}
			</td>
		</tr>
	);
}

export function ReconcilePanel() {
	const [result, setResult] = useState<ReconcileResult | null>(null);
	const [pending, startTransition] = useTransition();

	const run = (period: Period) =>
		startTransition(async () => {
			try {
				setResult(await reconcileSpend(period));
			} catch (error) {
				console.error("conciliación:", error);
				setResult({
					ok: false,
					message: "No pude conciliar. Probá de nuevo.",
				});
			}
		});

	return (
		<section>
			<h2 className="mb-1 text-lg">Conciliar con el gateway</h2>
			<p className="mb-3 text-muted-foreground text-sm">
				Compara lo asentado acá contra lo que cobró el AI Gateway por empresa.
				Cada consulta tiene costo, por eso es a pedido.
			</p>
			<div className="mb-4 flex flex-wrap gap-3">
				{PERIODS.map(({ key, label }) => (
					<Button
						disabled={pending}
						key={key}
						onClick={() => run(key)}
						variant="outline"
					>
						{label}
					</Button>
				))}
			</div>

			<div aria-live="polite">
				{pending ? (
					<p className="text-muted-foreground text-sm">
						Consultando el gateway…
					</p>
				) : null}

				{!pending && result && !result.ok ? (
					<p className="text-destructive text-sm" role="alert">
						{result.message}
					</p>
				) : null}
			</div>

			{!pending && result?.ok ? (
				<>
					<p className="mb-2 text-muted-foreground text-sm">
						Del {result.startDate} al {result.endDate}, en UTC.
					</p>
					<div className="overflow-x-auto rounded-lg border bg-card">
						<table className="w-full text-sm">
							<thead className="text-left text-muted-foreground">
								<tr>
									<th className="px-4 py-2 font-normal" scope="col">
										Empresa
									</th>
									<th className="px-4 py-2 text-right font-normal" scope="col">
										Libro
									</th>
									<th className="px-4 py-2 text-right font-normal" scope="col">
										Gateway
									</th>
									<th className="px-4 py-2 text-right font-normal" scope="col">
										Diferencia
									</th>
									<th className="px-4 py-2 text-right font-normal" scope="col">
										%
									</th>
								</tr>
							</thead>
							<tbody className="divide-y">
								{result.lines.map((line) => (
									<LineRow key={line.key} line={line} />
								))}
							</tbody>
						</table>
					</div>
					<p className="mt-2 text-muted-foreground text-xs">
						Se marca una diferencia mayor a US$ 1 o al 5 %, la que sea más
						grande. Causas conocidas: pasos abortados o fallidos que el gateway
						cobra y nadie informa, asientos con precio de tabla, la compactación
						de contexto y la demora de ingesta del gateway. El reporte del
						gateway es de todo el team de Vercel: "Sin etiqueta" es lo que se
						cobró sin tag de empresa, y si no es cero puede ser una llamada que
						salió sin etiquetar, pero también evals, scripts o tráfico local y
						de previews. Al revés, lo etiquetado de chats locales o de previews
						cae en el mismo tag de la empresa y suma en la columna Gateway sin
						estar en el libro de producción.
					</p>
				</>
			) : null}
		</section>
	);
}
