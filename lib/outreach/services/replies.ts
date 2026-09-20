// Lectura de respuestas para revisión humana (Task 8 de la etapa 5). Sin
// approval: solo lee. Devuelve el texto del evento tal cual quedó guardado,
// sin interpretar — la clasificación (interés, reunión, baja, ambiguo) la
// hace el modelo con la skill outreach-escucha, no esta función.
import type { Caller } from "../session";
import type { OutreachStore } from "../store";

export interface Respuesta {
	contactKey: string;
	nombre: string | null;
	empresa: string | null;
	texto: string;
	fecha: string;
}

export async function listReplies(
	input: { caller: Caller },
	deps: { store: OutreachStore },
): Promise<{ ok: true; respuestas: Respuesta[] }> {
	const pending = await deps.store.listPendingReplies(input.caller.tenantId);
	return {
		ok: true,
		respuestas: pending.map((r) => ({
			contactKey: r.contactKey,
			nombre: r.name,
			empresa: r.company,
			texto: r.text,
			fecha: r.occurredAt,
		})),
	};
}
