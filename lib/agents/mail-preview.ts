// Qué muestra el chat como "mail tal cual sale". La parte pura vive acá para
// poder probarla: el componente solo pinta lo que estas funciones devuelven.

/** Una pieza de la cola, como la muestra la tarjeta de `list_queue`. */
export interface QueuePreviewItem {
	letter: string;
	queueItemId: string;
	to: string;
	subject: string;
	body: string;
	trabada: boolean;
	gate: string | null;
}

const str = (value: unknown): string | null =>
	typeof value === "string" && value.trim() !== "" ? value : null;

/**
 * Un payload de aprobación es un mail cuando trae destinatario, asunto y
 * cuerpo: ahí el cuerpo se muestra con la firma, como lo lee el destinatario.
 * Una nota del CRM o una página del brain también tienen texto largo, pero no
 * se firman.
 */
export function isEmailApproval(input: Record<string, unknown>): boolean {
	return (
		str(input.to) !== null &&
		str(input.subject) !== null &&
		str(input.body) !== null
	);
}

/**
 * Piezas de la salida de `list_queue`. Descarta lo que no tenga letra, cuerpo y
 * asunto: la tarjeta prefiere mostrar de menos antes que inventar una pieza.
 */
export function queuePreviewItems(output: unknown): QueuePreviewItem[] {
	if (typeof output !== "object" || output === null) return [];
	const items = (output as { items?: unknown }).items;
	if (!Array.isArray(items)) return [];
	const out: QueuePreviewItem[] = [];
	for (const raw of items) {
		if (typeof raw !== "object" || raw === null) continue;
		const item = raw as Record<string, unknown>;
		const letter = str(item.letter);
		const subject = str(item.subject);
		const body = str(item.body);
		if (!letter || !subject || !body) continue;
		out.push({
			letter,
			queueItemId: str(item.queueItemId) ?? letter,
			to: str(item.to) ?? "",
			subject,
			body,
			trabada: item.trabada === true,
			gate: str(item.gate),
		});
	}
	return out;
}
