import type { EveMessage } from "eve/client";

/**
 * Identificador interno del último tool despachado que todavía no devolvió
 * resultado, o `null` si el turno no está esperando a ninguno. NO es texto
 * para mostrar: son los nombres en inglés de `agents/outreach/tools/`, así
 * que quien lo consuma tiene que pasarlo por una etiqueta en castellano.
 *
 * El scan va de atrás para adelante y corta en el último `dynamic-tool` en
 * orden de array. Si ese part ya es terminal (`output-available`,
 * `output-error`, `output-denied`) el agente volvió a pensar y no espera a
 * nadie. `approval-requested` devuelve null a propósito: ahí manda la
 * tarjeta de aprobación, no el indicador. `input-streaming` también, porque
 * el `toolName` todavía puede estar llegando.
 *
 * Límite conocido: con tools en paralelo en un mismo mensaje, un hermano ya
 * terminado tapa a uno que sigue corriendo. eve no los ordena por tiempo, y
 * el indicador prefiere quedarse corto antes que nombrar un tool que ya
 * terminó.
 */
export function runningToolName(
	messages: readonly EveMessage[],
): string | null {
	for (let i = messages.length - 1; i >= 0; i--) {
		const parts = messages[i].parts;
		for (let j = parts.length - 1; j >= 0; j--) {
			const part = parts[j];
			if (part.type !== "dynamic-tool") continue;
			return part.state === "input-available" ||
				part.state === "approval-responded"
				? part.toolName
				: null;
		}
	}
	return null;
}

// Etiqueta en castellano de cada tool, para el indicador de actividad: la UI
// va en rioplatense y `toolName` son identificadores en inglés (CLAUDE.md).
// Un tool sin entrada acá cae en "Trabajando…", nunca muestra el id crudo.
const TOOL_LABELS: Record<string, string> = {
	brain: "Leyendo el brain",
	crm_setup_outreach_properties: "Preparando el CRM",
	crm_upsert_contact: "Escribiendo en el CRM",
	draft_message: "Escribiendo el mensaje",
	import_contacts: "Importando contactos",
	list_queue: "Mirando la cola",
	log_event: "Registrando el evento",
	queue_touch: "Anotando el toque",
	reject_queue_item: "Descartando la pieza",
	research_account: "Investigando la cuenta",
	send_email: "Mandando el mail",
	update_queue_item: "Actualizando la pieza",
};

/** Qué mostrar mientras corre `toolName`. Nunca devuelve el id crudo. */
export function runningToolLabel(toolName: string): string {
	return TOOL_LABELS[toolName] ?? "Trabajando";
}
