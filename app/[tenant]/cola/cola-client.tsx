"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardFooter,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { ColaRow } from "@/lib/outreach/cola-query";
import { createBrowserSupabase } from "@/lib/supabase/browser";
import {
	approveAndSend,
	type ColaResult,
	editItem,
	rejectItem,
} from "./actions";

function formatVence(iso: string): string {
	const at = new Date(iso);
	if (Number.isNaN(at.getTime())) return "—";
	return new Intl.DateTimeFormat("es-AR", {
		dateStyle: "short",
		timeStyle: "short",
	}).format(at);
}

export function ColaClient({
	slug,
	tenantId,
	currentUserId,
	rows,
}: {
	slug: string;
	tenantId: string;
	currentUserId: string;
	rows: ColaRow[];
}) {
	const router = useRouter();

	// Suscripción con el cliente del usuario (anon key + JWT), nunca con
	// service role: la RLS de queue_items es lo único que separa la cola de
	// un tenant de la de otro, y una key elevada en el navegador la rompe.
	useEffect(() => {
		const supabase = createBrowserSupabase();
		const channel = supabase
			.channel(`cola-${tenantId}`)
			.on(
				"postgres_changes",
				{
					event: "*",
					schema: "public",
					table: "queue_items",
					filter: `tenant_id=eq.${tenantId}`,
				},
				() => router.refresh(),
			)
			.subscribe();

		return () => {
			supabase.removeChannel(channel);
		};
	}, [tenantId, router]);

	if (rows.length === 0) {
		return (
			<p className="text-muted-foreground">
				No hay piezas esperando. Pedile al agente que arme la cola desde el
				chat.
			</p>
		);
	}

	return (
		<ul className="flex flex-col gap-4">
			{rows.map((row) => (
				<li key={row.id}>
					<ColaCard currentUserId={currentUserId} row={row} slug={slug} />
				</li>
			))}
		</ul>
	);
}

function ColaCard({
	slug,
	currentUserId,
	row,
}: {
	slug: string;
	currentUserId: string;
	row: ColaRow;
}) {
	const [mode, setMode] = useState<"view" | "edit" | "reject">("view");
	const [subject, setSubject] = useState(row.subject);
	const [body, setBody] = useState(row.body);
	const [reason, setReason] = useState("");
	const [result, setResult] = useState<ColaResult | null>(null);
	const [isPending, startTransition] = useTransition();

	const isOwner = row.ownerUserId === currentUserId;

	function runAction(run: () => Promise<ColaResult>, onOk?: () => void) {
		startTransition(async () => {
			try {
				const outcome = await run();
				setResult(outcome.ok ? null : outcome);
				if (outcome.ok) onOk?.();
			} catch {
				// Las actions traducen los casos conocidos (grant vencido, pieza
				// ausente, negativa del servicio) a ColaResult; lo que llega acá
				// es lo que no contemplaron (error de base, timeout, un 500 que
				// no es de autorización). No sabemos si la acción llegó a
				// aplicarse del lado del servidor, así que el mensaje no
				// afirma que falló: pide revisar antes de reintentar.
				setResult({
					ok: false,
					message:
						"Algo se cortó al procesar la acción. No sabemos si llegó a aplicarse: revisá el estado de la pieza antes de reintentar.",
				});
			}
		});
	}

	function handleApprove() {
		runAction(() => approveAndSend(slug, row.id));
	}

	function handleSaveEdit() {
		runAction(
			() => editItem(slug, row.id, subject, body),
			() => setMode("view"),
		);
	}

	function handleReject() {
		if (reason.trim().length === 0) return;
		runAction(
			() => rejectItem(slug, row.id, reason),
			() => setMode("view"),
		);
	}

	return (
		<Card>
			<CardHeader>
				<CardTitle className="flex flex-wrap items-center gap-2">
					{row.subject}
					{row.trabada ? (
						<span className="rounded-full bg-destructive/10 px-2 py-0.5 text-destructive text-xs">
							Trabada
						</span>
					) : null}
				</CardTitle>
			</CardHeader>
			<CardContent className="space-y-3">
				<dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
					<dt className="text-muted-foreground">Para</dt>
					<dd>{row.toEmail}</dd>
					<dt className="text-muted-foreground">Contacto</dt>
					<dd>
						{row.contactName ?? "—"}
						{row.contactCompany ? ` · ${row.contactCompany}` : ""}
					</dd>
					<dt className="text-muted-foreground">Etapa</dt>
					<dd>{row.contactStage ?? "—"}</dd>
					<dt className="text-muted-foreground">Hook</dt>
					<dd>{row.hook || "—"}</dd>
					<dt className="text-muted-foreground">Vector</dt>
					<dd>{row.vector || "—"}</dd>
					<dt className="text-muted-foreground">Dueño</dt>
					<dd>{row.ownerSlug ?? "sin asignar"}</dd>
					<dt className="text-muted-foreground">Vence</dt>
					<dd>{formatVence(row.expiresAt)}</dd>
				</dl>

				{mode === "edit" ? (
					<div className="space-y-2">
						<Input
							aria-label="Asunto"
							disabled={isPending}
							onChange={(event) => setSubject(event.target.value)}
							value={subject}
						/>
						<Textarea
							aria-label="Cuerpo"
							disabled={isPending}
							onChange={(event) => setBody(event.target.value)}
							rows={6}
							value={body}
						/>
					</div>
				) : (
					<p className="whitespace-pre-wrap rounded-md border bg-background p-3">
						{row.body}
					</p>
				)}

				{mode === "reject" ? (
					<Textarea
						aria-label="Motivo del descarte"
						disabled={isPending}
						onChange={(event) => setReason(event.target.value)}
						placeholder="Por qué se descarta esta pieza"
						value={reason}
					/>
				) : null}

				{row.trabada && row.error ? (
					<p className="text-destructive text-sm">{row.error}</p>
				) : null}

				{result && !result.ok ? (
					<p className="text-destructive text-sm">
						{result.message}
						{result.authUrl ? (
							<>
								{" "}
								<a
									className="underline"
									href={result.authUrl}
									rel="noopener noreferrer"
									target="_blank"
								>
									{result.provider === "hubspot"
										? "Autorizá HubSpot"
										: "Autorizá Google"}
								</a>
							</>
						) : null}
					</p>
				) : null}
			</CardContent>
			<CardFooter className="flex flex-wrap gap-2">
				{row.trabada ? null : isOwner ? (
					<CardActions
						isPending={isPending}
						mode={mode}
						onApprove={handleApprove}
						onCancel={() => {
							setMode("view");
							setSubject(row.subject);
							setBody(row.body);
							setReason("");
							setResult(null);
						}}
						onEdit={() => setMode("edit")}
						onReject={() => setMode("reject")}
						onRejectConfirm={handleReject}
						onSaveEdit={handleSaveEdit}
						reasonEmpty={reason.trim().length === 0}
					/>
				) : (
					<p className="text-muted-foreground text-sm">
						De {row.ownerSlug ?? "otra persona"}
					</p>
				)}
			</CardFooter>
		</Card>
	);
}

function CardActions({
	mode,
	isPending,
	reasonEmpty,
	onApprove,
	onEdit,
	onReject,
	onRejectConfirm,
	onSaveEdit,
	onCancel,
}: {
	mode: "view" | "edit" | "reject";
	isPending: boolean;
	reasonEmpty: boolean;
	onApprove: () => void;
	onEdit: () => void;
	onReject: () => void;
	onRejectConfirm: () => void;
	onSaveEdit: () => void;
	onCancel: () => void;
}) {
	const buttonClass = "h-11 min-h-11 flex-1 sm:flex-none";

	if (mode === "edit") {
		return (
			<>
				<Button
					className={buttonClass}
					disabled={isPending}
					onClick={onSaveEdit}
					type="button"
				>
					Guardar
				</Button>
				<Button
					className={buttonClass}
					disabled={isPending}
					onClick={onCancel}
					type="button"
					variant="outline"
				>
					Cancelar
				</Button>
			</>
		);
	}

	if (mode === "reject") {
		return (
			<>
				<Button
					className={buttonClass}
					disabled={isPending || reasonEmpty}
					onClick={onRejectConfirm}
					type="button"
					variant="destructive"
				>
					Confirmar descarte
				</Button>
				<Button
					className={buttonClass}
					disabled={isPending}
					onClick={onCancel}
					type="button"
					variant="outline"
				>
					Cancelar
				</Button>
			</>
		);
	}

	return (
		<>
			<Button
				className={buttonClass}
				disabled={isPending}
				onClick={onApprove}
				type="button"
			>
				Aprobar y enviar
			</Button>
			<Button
				className={buttonClass}
				disabled={isPending}
				onClick={onEdit}
				type="button"
				variant="outline"
			>
				Editar
			</Button>
			<Button
				className={buttonClass}
				disabled={isPending}
				onClick={onReject}
				type="button"
				variant="destructive"
			>
				Descartar
			</Button>
		</>
	);
}
