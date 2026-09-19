"use client";

import { useState } from "react";
import { Card } from "@/components/ui/card";
import type { Metricas, MetricDimension } from "@/lib/outreach/metricas-query";

const DIMENSIONES: { key: MetricDimension; label: string }[] = [
	{ key: "hook", label: "Hook" },
	{ key: "vector", label: "Vector" },
	{ key: "segmento", label: "Segmento" },
	{ key: "ejecutor", label: "Ejecutor" },
];

export function MetricasClient({ metricas }: { metricas: Metricas }) {
	const [dimension, setDimension] = useState<MetricDimension>("hook");
	const rows = metricas[dimension];
	const sinEnvios = rows.every((row) => row.enviados === 0);

	return (
		<div className="flex flex-col gap-6">
			<header className="flex flex-col gap-1">
				<h1 className="font-semibold text-2xl tracking-display">Métricas</h1>
				<p className="text-muted-foreground text-sm">
					Qué hook, vector, segmento y ejecutor funcionan mejor.
				</p>
			</header>

			<div className="flex gap-2">
				{DIMENSIONES.map((d) => (
					<button
						key={d.key}
						type="button"
						onClick={() => setDimension(d.key)}
						className={
							d.key === dimension
								? "min-h-11 rounded-md bg-primary px-3 text-primary-foreground text-sm"
								: "min-h-11 rounded-md border px-3 text-sm hover:bg-muted/50"
						}
					>
						{d.label}
					</button>
				))}
			</div>

			{rows.length === 0 ? (
				<Card className="p-6">
					<p className="text-muted-foreground text-sm">
						Todavía no hay contactos para medir por esta dimensión.
					</p>
				</Card>
			) : (
				<Card className="divide-y">
					{rows.map((row) => (
						<div key={row.value} className="flex items-center gap-4 p-4">
							<div className="min-w-0 flex-1">
								<p className="truncate font-medium text-sm">{row.label}</p>
								<p className="text-muted-foreground text-xs tabular-nums">
									{row.enviados} {row.enviados === 1 ? "enviado" : "enviados"}
									{row.rebotados > 0
										? ` · ${row.rebotados} ${row.rebotados === 1 ? "rebotado" : "rebotados"}`
										: ""}
								</p>
							</div>
							<div className="shrink-0 text-right">
								<p className="font-semibold tabular-nums">{row.tasa}%</p>
								<p className="text-muted-foreground text-xs tabular-nums">
									{row.respondieron} de {row.enviados}
								</p>
							</div>
						</div>
					))}
					{sinEnvios ? (
						<p className="p-3 text-muted-foreground text-xs">
							Sin envíos todavía en esta dimensión: la tasa de respuesta va a
							empezar a decir algo cuando haya volumen.
						</p>
					) : null}
				</Card>
			)}
		</div>
	);
}
