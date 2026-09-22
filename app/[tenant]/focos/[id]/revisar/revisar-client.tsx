"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardFooter,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { discardContact, type FocoResult, qualifyContact } from "../../actions";
import type { RevisarContactRow } from "./page";

function formatScore(score: number | undefined): string {
	return score === undefined ? "—" : score.toFixed(2);
}

export function RevisarClient({
	slug,
	focusName,
	contacts,
}: {
	slug: string;
	focusName: string;
	contacts: RevisarContactRow[];
}) {
	// Optimistic removal: la action ya hace revalidatePath, pero eso solo
	// refresca /focos/<id>/revisar en la próxima navegación a esa ruta — esta
	// pantalla saca la fila de la lista al toque para que la persona no vea un
	// contacto "calificado"/"descartado" que sigue apareciendo para revisar.
	const [rows, setRows] = useState(contacts);

	function removeRow(contactId: string) {
		setRows((current) => current.filter((row) => row.id !== contactId));
	}

	return (
		<div className="flex flex-col gap-6">
			<header className="flex flex-col gap-1">
				<h1 className="font-semibold text-2xl tracking-display">
					Revisar · {focusName}
				</h1>
				<p className="text-muted-foreground text-sm">
					{rows.length === 0
						? "No hay contactos de baja confianza esperando revisión."
						: `${rows.length} ${rows.length === 1 ? "contacto" : "contactos"} de baja confianza.`}
				</p>
			</header>

			{rows.length === 0 ? null : (
				<ul className="flex flex-col gap-4">
					{rows.map((row) => (
						<li key={row.id}>
							<ContactoCard
								contact={row}
								onDone={() => removeRow(row.id)}
								slug={slug}
							/>
						</li>
					))}
				</ul>
			)}
		</div>
	);
}

function ContactoCard({
	slug,
	contact,
	onDone,
}: {
	slug: string;
	contact: RevisarContactRow;
	onDone: () => void;
}) {
	const [mode, setMode] = useState<"view" | "descartar">("view");
	const [reason, setReason] = useState("");
	const [result, setResult] = useState<FocoResult | null>(null);
	const [isPending, startTransition] = useTransition();

	// icp.encaje_empresa/icp.rol_decisor pueden ser null (juicio_incompleto),
	// aunque en la práctica casi siempre están los tres y lo que faltó fue
	// confianza (confianza_baja), no el juicio en sí — igual el render no lo
	// asume.
	const encaje = contact.icp?.encaje_empresa ?? null;
	const rol = contact.icp?.rol_decisor ?? null;
	const confianza =
		encaje && rol ? Math.min(encaje.confidence, rol.confidence) : undefined;
	const reason_ = contact.icp?.reason ?? "—";

	function runAction(run: () => Promise<FocoResult>) {
		startTransition(async () => {
			try {
				const outcome = await run();
				if (outcome.ok) {
					setResult(null);
					onDone();
					return;
				}
				setResult(outcome);
			} catch {
				// La action traduce los casos conocidos a FocoResult; lo que llega
				// acá es lo que no contempló (error de base, timeout). No sabemos si
				// llegó a aplicarse del lado del servidor, así que el mensaje no
				// afirma que falló: pide revisar antes de reintentar.
				setResult({
					ok: false,
					message:
						"Algo se cortó al procesar la acción. No sabemos si llegó a aplicarse: revisá el estado del contacto antes de reintentar.",
				});
			}
		});
	}

	function handleQualify() {
		runAction(() => qualifyContact(slug, contact.id));
	}

	function handleDiscardConfirm() {
		if (reason.trim().length === 0) return;
		runAction(() => discardContact(slug, contact.id, reason));
	}

	return (
		<Card>
			<CardHeader>
				<CardTitle>{contact.name ?? "Sin nombre"}</CardTitle>
			</CardHeader>
			<CardContent className="space-y-3">
				<dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-sm sm:grid-cols-4">
					<dt className="text-muted-foreground">Empresa</dt>
					<dd>{contact.company ?? "—"}</dd>
					<dt className="text-muted-foreground">Cargo</dt>
					<dd>{contact.title ?? "—"}</dd>
					<dt className="text-muted-foreground">Encaje empresa</dt>
					<dd className="tabular-nums">{formatScore(encaje?.score)}</dd>
					<dt className="text-muted-foreground">Rol decisor</dt>
					<dd className="tabular-nums">{formatScore(rol?.score)}</dd>
					<dt className="text-muted-foreground">Confianza mínima</dt>
					<dd className="tabular-nums">{formatScore(confianza)}</dd>
					<dt className="text-muted-foreground">Motivo</dt>
					<dd>{reason_}</dd>
				</dl>

				{mode === "descartar" ? (
					<Input
						aria-label="Motivo del descarte"
						disabled={isPending}
						onChange={(event) => setReason(event.target.value)}
						placeholder="Por qué se descarta este contacto"
						value={reason}
					/>
				) : null}

				{result && !result.ok ? (
					<p className="text-destructive text-sm">{result.message}</p>
				) : null}
			</CardContent>
			<CardFooter className="flex flex-wrap gap-2">
				{mode === "descartar" ? (
					<>
						<Button
							disabled={isPending || reason.trim().length === 0}
							onClick={handleDiscardConfirm}
							type="button"
							variant="destructive"
						>
							Confirmar descarte
						</Button>
						<Button
							disabled={isPending}
							onClick={() => {
								setMode("view");
								setReason("");
								setResult(null);
							}}
							type="button"
							variant="outline"
						>
							Cancelar
						</Button>
					</>
				) : (
					<>
						<Button disabled={isPending} onClick={handleQualify} type="button">
							Calificar
						</Button>
						<Button
							disabled={isPending}
							onClick={() => setMode("descartar")}
							type="button"
							variant="destructive"
						>
							Descartar
						</Button>
					</>
				)}
			</CardFooter>
		</Card>
	);
}
