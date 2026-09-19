"use client";

import { useState } from "react";
import { Card } from "@/components/ui/card";
import type { AccountRow } from "@/lib/outreach/cuentas-query";

const fecha = (value: string) =>
	value ? new Date(value).toLocaleDateString("es-AR") : "—";

export function CuentasClient({ rows }: { rows: AccountRow[] }) {
	return (
		<div className="flex flex-col gap-6">
			<header className="flex flex-col gap-1">
				<h1 className="font-semibold text-2xl tracking-display">Cuentas</h1>
				<p className="text-muted-foreground text-sm">
					{rows.length === 0
						? "Todavía no se investigó ninguna cuenta."
						: `${rows.length} ${rows.length === 1 ? "cuenta" : "cuentas"}.`}
				</p>
			</header>

			{rows.length === 0 ? (
				<Card className="p-6">
					<p className="text-muted-foreground text-sm">
						Pedile al agente que investigue una empresa desde el chat.
					</p>
				</Card>
			) : (
				<Card className="divide-y">
					{rows.map((row) => (
						<AccountCard key={row.id} row={row} />
					))}
				</Card>
			)}
		</div>
	);
}

function AccountCard({ row }: { row: AccountRow }) {
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
					<p className="truncate font-medium text-sm">{row.name}</p>
					<p className="truncate text-muted-foreground text-xs">{row.domain}</p>
				</div>
				<div className="shrink-0 text-right">
					<p className="text-xs">
						{row.contactCount}{" "}
						{row.contactCount === 1 ? "contacto" : "contactos"}
					</p>
					<p
						className={
							row.vencida
								? "text-destructive text-xs"
								: "text-muted-foreground text-xs"
						}
					>
						{row.vencida ? "vencida" : "vigente"} · {fecha(row.researchedAt)}
					</p>
				</div>
				<span aria-hidden="true" className="shrink-0 text-muted-foreground">
					{abierto ? "−" : "+"}
				</span>
			</button>
			{abierto ? <Ficha row={row} /> : null}
		</div>
	);
}

const CAMPOS_FICHA: {
	key:
		| "produce"
		| "gana"
		| "compra"
		| "rompe_si_crece"
		| "gap_declarado"
		| "gap_demostrable";
	label: string;
}[] = [
	{ key: "produce", label: "Qué produce" },
	{ key: "gana", label: "Con qué gana" },
	{ key: "compra", label: "Qué compra" },
	{ key: "rompe_si_crece", label: "Dónde rompe si crece" },
	{ key: "gap_declarado", label: "Gap declarado" },
	{ key: "gap_demostrable", label: "Gap demostrable" },
];

function Ficha({ row }: { row: AccountRow }) {
	if (!row.ficha) {
		return (
			<p className="border-t bg-muted/30 px-4 py-3 text-muted-foreground text-sm">
				La ficha guardada no se puede mostrar: hay que volver a investigar la
				cuenta desde el chat.
			</p>
		);
	}

	const { ficha } = row;

	return (
		<dl className="flex flex-col gap-3 border-t bg-muted/30 px-4 py-3 text-sm">
			{CAMPOS_FICHA.map(({ key, label }) =>
				ficha[key] ? (
					<div key={key}>
						<dt className="text-muted-foreground text-xs">{label}</dt>
						<dd>{ficha[key]}</dd>
					</div>
				) : null,
			)}
			{ficha.hechos.length > 0 ? (
				<div>
					<dt className="text-muted-foreground text-xs">Hechos</dt>
					<dd>
						<ul className="mt-1 flex flex-col gap-1">
							{ficha.hechos.map((hecho) => (
								<li key={hecho.url}>
									<a
										href={hecho.url}
										target="_blank"
										rel="noreferrer"
										className="underline underline-offset-4"
									>
										{hecho.hecho}
									</a>
								</li>
							))}
						</ul>
					</dd>
				</div>
			) : null}
		</dl>
	);
}
