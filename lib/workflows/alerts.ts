// Avisos de workflows para el resumen que abre el chat (spec orquestación
// §10.4 y §11). Sin sistema de notificaciones nuevo: son líneas de texto que
// sessionSummary suma a las suyas. Imports relativos.

/** Ventana de los avisos: lo mismo que mira el resumen para las respuestas. */
export const ALERT_WINDOW_MS = 86_400_000;

export interface WorkflowHealth {
	/** Workflows con alguna pasada `budget_exhausted` en la ventana. */
	budgetExhausted: string[];
	/** Pasadas `failed`: config inválida, abandonadas o que explotaron. */
	failedRuns: number;
	/** Pasadas `ok` con error: la cuenta reclamados = ok + rechazados + fallidos no cerró. */
	unbalancedRuns: number;
	/** Ítems que pasaron a `failed` en la ventana. */
	failedItems: number;
	/** Workflows prendidos sin pasadas en la ventana. */
	silent: string[];
}

export function workflowAlertLines(health: WorkflowHealth): string[] {
	const lines: string[] = [];
	if (health.budgetExhausted.length > 0)
		lines.push(
			`Workflows frenados por presupuesto en las últimas 24 h: ${health.budgetExhausted.join(", ")}. Lo desatendido no gasta hasta mañana o hasta que se suba el tope.`,
		);
	if (health.failedItems > 0)
		lines.push(
			health.failedItems === 1
				? "1 ítem de workflows quedó en failed en las últimas 24 h: alguien tiene que mirarlo."
				: `${health.failedItems} ítems de workflows quedaron en failed en las últimas 24 h: alguien tiene que mirarlos.`,
		);
	if (health.failedRuns > 0)
		lines.push(
			health.failedRuns === 1
				? "1 pasada de workflows falló en las últimas 24 h."
				: `${health.failedRuns} pasadas de workflows fallaron en las últimas 24 h.`,
		);
	if (health.unbalancedRuns > 0)
		lines.push(
			`${health.unbalancedRuns === 1 ? "1 pasada" : `${health.unbalancedRuns} pasadas`} de workflows cerró con una cuenta que no cierra: es un bug de la plataforma, avisá a quien la administra.`,
		);
	if (health.silent.length > 0)
		lines.push(
			`Workflows prendidos que no corrieron en las últimas 24 h: ${health.silent.join(", ")}.`,
		);
	return lines;
}
