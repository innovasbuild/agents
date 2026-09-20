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
export const TOOL_LABELS: Record<string, string> = {
	brain: "Leyendo el brain",
	crm_setup_outreach_properties: "Preparando el CRM",
	crm_upsert_contact: "Escribiendo en el CRM",
	draft_message: "Escribiendo el mensaje",
	import_contacts: "Importando contactos",
	list_queue: "Mirando la cola",
	log_event: "Registrando el evento",
	queue_touch: "Anotando el toque",
	read_replies: "Leyendo respuestas",
	reject_queue_item: "Descartando la pieza",
	research_account: "Investigando la cuenta",
	send_email: "Mandando el mail",
	update_queue_item: "Actualizando la pieza",
};

/**
 * Tools que a propósito no se nombran en pantalla (spikes, diagnóstico). Hoy
 * está vacía: los doce tools del agente tienen etiqueta.
 * `tests/agents/running-tool.test.ts` compara esta lista contra el disco, así
 * que un tool nuevo rompe el test hasta que alguien decida su etiqueta.
 */
export const TOOLS_SIN_ETIQUETA = new Set<string>();

/**
 * Qué mostrar mientras corre `toolName`. Nunca devuelve el id crudo.
 *
 * `Object.hasOwn` y no `??`: con un objeto literal, `TOOL_LABELS["constructor"]`
 * devuelve la función Object heredada del prototipo y la pantalla mostraría
 * "function Object() { [native code] }…".
 */
export function runningToolLabel(toolName: string): string {
	return Object.hasOwn(TOOL_LABELS, toolName)
		? TOOL_LABELS[toolName]
		: "Trabajando";
}

/**
 * Qué decir en el indicador de actividad, o `null` para no mostrar nada.
 *
 * Vive acá y no en el componente para que las reglas se puedan probar: son
 * cuatro señales que se pisan entre sí y cada una tiene su motivo.
 */
export function thinkingLabel(params: {
	messages: readonly EveMessage[];
	status: string;
	isResuming: boolean;
	isAuthorizing: boolean;
	pendingRequestCount: number;
}): string | null {
	// Con una tarjeta abierta el turno está parqueado esperando a la persona:
	// la señal es la tarjeta, no los puntitos.
	if (params.isAuthorizing || params.pendingRequestCount > 0) return null;
	if (params.isResuming) return "Reanudando el hilo…";

	const tool = runningToolName(params.messages);
	if (tool !== null) return `${runningToolLabel(tool)}…`;

	// `streaming` sin texto EN CURSO incluye el tramo en el que llegan los
	// argumentos de un tool: ahí no hay nada que mirar, y una pantalla quieta
	// se lee como colgada. Solo el texto que todavía se está escribiendo apaga
	// los puntitos: un texto ya terminado es estático, y como todos los pasos
	// de un turno viven en el MISMO mensaje, mirar si el texto existe apagaba
	// el indicador en todos los tools que vienen después de la primera frase.
	if (params.status === "submitted") return "Pensando…";
	if (params.status === "streaming" && !isWritingText(params.messages)) {
		return "Pensando…";
	}
	return null;
}

function isWritingText(messages: readonly EveMessage[]): boolean {
	const last = messages.at(-1);
	if (last === undefined || last.role === "user") return false;
	return last.parts.some(
		(part) =>
			part.type === "text" &&
			part.state === "streaming" &&
			part.text.length > 0,
	);
}
