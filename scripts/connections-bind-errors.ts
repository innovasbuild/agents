// Import con extensión .ts no hace falta: no importa nada. Lo ejecuta Node directo.
export function describeBindError(
	error: { code?: string; message: string },
	enabledBrain: string | null,
): string {
	if (
		error.code === "23505" &&
		error.message.includes("tenant_connections_one_brain")
	) {
		return `el tenant ya tiene un brain habilitado (${enabledBrain ?? "desconocido"}): deshabilitalo antes de dar de alta otro`;
	}
	return `no pude guardar el binding: ${error.message}`;
}
