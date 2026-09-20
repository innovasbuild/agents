// Núcleo puro de la escucha: decide qué efectos corresponden a los mensajes
// de un hilo de Gmail, sin ejecutarlos. No toca la base ni Gmail — eso lo
// hace el sweep que consume `planListen` en una task posterior.
// Imports relativos y no "@/": el sweep que consume esto vive dentro de un
// schedule de eve, que no resuelve los paths de tsconfig (mismo motivo que
// lib/agents/channel-context.ts).
import type { GmailMessage } from "../gmail/read";
import type { OutreachStage } from "./stage";
import { canAdvance } from "./stage";
import type { ContactRow } from "./store";

export interface ListenEffect {
	event: {
		type: "respuesta" | "rebote";
		gmailMessageId: string;
		summary: string;
	};
	repliedAt: string | null;
	stage: OutreachStage | null;
}

// Mismo tope que el resto de los summaries del repo (ver events.ts).
const MAX_SUMMARY_CHARS = 500;

function summaryOf(message: GmailMessage): string {
	return message.body.trim().slice(0, MAX_SUMMARY_CHARS);
}

export function planListen(input: {
	// La etapa y el replied_at: lo primero decide hasta dónde puede avanzar el
	// contacto, lo segundo si el patch de una respuesta ya registrada llegó a
	// aplicarse. Pedir la fila entera obligaría al sweep a leer columnas que no
	// usa.
	contact: Pick<ContactRow, "stage" | "repliedAt">;
	messages: readonly GmailMessage[];
	knownMessageIds: ReadonlySet<string>;
	now: Date;
}): ListenEffect[] {
	const effects: ListenEffect[] = [];

	for (const message of input.messages) {
		// 1. Nuestros propios mensajes no son "escucha".
		if (message.isFromUs) continue;

		// 2. El dedup de la base es el segundo cinturón; este es el primero.
		//
		// Pero el evento prueba que el HECHO quedó registrado, no que el patch
		// del contacto se haya aplicado: el sweep escribe el evento primero
		// (events es append-only y el evento no se puede perder) y el patch
		// después. Si el patch falla, el mensaje queda "conocido" con el contacto
		// sin `replied_at`, la cadencia de follow-ups viva, y nadie lo repara.
		// Por eso una respuesta real cuyo `replied_at` sigue en null se vuelve a
		// emitir: la corrida siguiente termina el trabajo a medias. El re-insert
		// del evento lo absorbe el dedup por `gmail_message_id` (23505 = ya
		// registrado).
		//
		// Solo aplica a las respuestas reales: un rebote y un auto-reply no
		// escriben `replied_at` a propósito, así que su estado correcto es
		// indistinguible de un patch que falló y reprocesarlos todos los días no
		// repararía nada.
		const realReply = !message.isBounce && !message.isAutoReply;
		const patchPendiente = realReply && input.contact.repliedAt === null;
		if (input.knownMessageIds.has(message.id) && !patchPendiente) continue;

		// 3. Un rebote no es una respuesta: no toca replied_at ni la etapa.
		if (message.isBounce) {
			effects.push({
				event: {
					type: "rebote",
					gmailMessageId: message.id,
					summary: summaryOf(message),
				},
				repliedAt: null,
				stage: null,
			});
			continue;
		}

		// 4. Un auto-reply ("estoy de vacaciones") se registra como evento pero
		// sin replied_at: si lo tratáramos como respuesta real, la cadencia de
		// follow-ups de ese contacto se apaga para siempre por un mail que
		// nunca leyó.
		if (message.isAutoReply) {
			effects.push({
				event: {
					type: "respuesta",
					gmailMessageId: message.id,
					summary: summaryOf(message),
				},
				repliedAt: null,
				stage: null,
			});
			continue;
		}

		// 5. Respuesta real: avanza a respuesta_neutra solo si la escalera lo
		// permite (nunca retrocede a un contacto que ya está más arriba).
		effects.push({
			event: {
				type: "respuesta",
				gmailMessageId: message.id,
				summary: summaryOf(message),
			},
			repliedAt: input.now.toISOString(),
			stage: canAdvance(input.contact.stage, "respuesta_neutra")
				? "respuesta_neutra"
				: null,
		});
	}

	return effects;
}
