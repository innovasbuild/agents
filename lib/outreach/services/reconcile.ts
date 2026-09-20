// Confirmar envíos inciertos. La regla que no se negocia: solo se confirma lo
// que se puede probar. Si el mensaje no aparece en enviados, la pieza queda
// trabada y la mira una persona — reencolar arriesga un segundo mail al mismo
// contacto, que es el peor error posible de esta herramienta. Nunca reintenta.
import type { QueueItemRow } from "../store";

export type ReconcileVerdict =
	| { action: "confirmar"; gmailMessageId: string; gmailThreadId: string }
	| { action: "dejar_trabada"; motivo: string };

/** Hace cuánto está trabada, en palabras, para el resumen de la mañana.
 * approvedAt debería estar siempre presente en una pieza `approved`; si por
 * algún motivo falta, no inventamos una fecha. */
function elapsedText(approvedAt: string | null, now: Date): string {
	if (!approvedAt) return "un tiempo indeterminado";
	const approvedMs = new Date(approvedAt).getTime();
	const minutes = Math.max(
		0,
		Math.round((now.getTime() - approvedMs) / 60_000),
	);
	if (minutes < 60) return `${minutes} min`;
	const hours = Math.round(minutes / 60);
	if (hours < 24) return `${hours} h`;
	const days = Math.round(hours / 24);
	return `${days} d`;
}

export function planReconcile(input: {
	// Solo `approvedAt`: es lo único que el veredicto mira.
	item: Pick<QueueItemRow, "approvedAt">;
	found: { id: string; threadId: string } | null;
	now: Date;
}): ReconcileVerdict {
	if (input.found) {
		return {
			action: "confirmar",
			gmailMessageId: input.found.id,
			gmailThreadId: input.found.threadId,
		};
	}
	const desde = elapsedText(input.item.approvedAt, input.now);
	return {
		action: "dejar_trabada",
		motivo: `no aparece en enviados hace ${desde}: hay que revisarla a mano antes de volver a tocarla`,
	};
}
