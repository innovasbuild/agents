// Toda negativa de un guard es un resultado, no una excepción (spec 03 D13):
// el modelo cita `message` en vez de buscar otra vía.
export interface Refusal {
	ok: false;
	reason: string;
	message: string;
}

export function refuse(reason: string, message: string): Refusal {
	return { ok: false, reason, message };
}

export function isRefusal(value: unknown): value is Refusal {
	return (
		typeof value === "object" &&
		value !== null &&
		(value as { ok?: unknown }).ok === false &&
		typeof (value as { reason?: unknown }).reason === "string"
	);
}
