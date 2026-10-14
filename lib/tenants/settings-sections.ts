// Qué secciones de /settings se muestran según los agentes habilitados (spec
// 21.4 §3.4, 22.1 §8). Puro: quien llama le pasa lo que leyó.

export interface SettingsSections {
	model: boolean;
	executors: boolean;
	approvals: boolean;
	connections: boolean;
}

/**
 * `enabledAgents` es `null` si no se pudo leer: se muestra todo, una falla no
 * degrada a una empresa que sí tiene agentes. Ejecutores es de outreach (el
 * Asistente no tiene), y Aprobaciones aparece con outreach o si algún agente
 * habilitado tiene pasos para aprobar (`approvableCount`).
 */
export function settingsSections(
	enabledAgents: readonly string[] | null,
	approvableCount: number,
): SettingsSections {
	if (enabledAgents === null) {
		return { model: true, executors: true, approvals: true, connections: true };
	}
	const anyAgent = enabledAgents.length > 0;
	const outreach = enabledAgents.includes("outreach");
	return {
		model: anyAgent,
		executors: outreach,
		approvals: outreach || approvableCount > 0,
		connections: anyAgent,
	};
}
