// Regla del botón de enviar del chat. Pura: el compositor le pasa su estado.

/**
 * Se envía con texto o con un adjunto, y solo si nada bloquea la entrada
 * (tarjeta pendiente, sesión reanudándose, hilo abriéndose).
 */
export function canSendMessage({
	text,
	hasFile,
	blocked,
}: {
	text: string;
	hasFile: boolean;
	blocked: boolean;
}): boolean {
	return !blocked && (text.trim().length > 0 || hasFile);
}
