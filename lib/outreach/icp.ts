// La política de decisión del scoring (spec etapa 13 §7.3 y §7.4). Función
// pura sobre los juicios crudos: cambiar un umbral re-decide a todos sin
// volver a llamar a Jev.
import type { JevNoul, JevScore } from "./services/evaluate";

export interface IcpJudgments {
	encaje: JevScore | null;
	rol: JevScore | null;
	excluir: JevNoul | null;
}

export interface IcpThresholds {
	encaje: number;
	rol: number;
	confidence: number;
	excluir: number;
}

/** Conservadores a propósito: no se aflojan hasta tener el contraste con lo
 * que el humano aprobó y el mercado contestó (spec §7.5). */
export const DEFAULT_ICP_THRESHOLDS: IcpThresholds = {
	encaje: 1.5,
	rol: 1.0,
	confidence: 0.7,
	excluir: 0.2,
};

export type IcpLane = "calificado" | "descartado" | "para_revisar";

export function decideIcp(
	judgments: IcpJudgments,
	thresholds: IcpThresholds,
): { lane: IcpLane; reason: string } {
	const { encaje, rol, excluir } = judgments;
	if (!encaje || !rol || !excluir) {
		return { lane: "para_revisar", reason: "juicio_incompleto" };
	}

	// El excluyente se evalúa primero, pero solo decide si viene seguro. Un
	// "puede que sea competidora" con la moneda al aire va a revisión.
	if (excluir.probability >= 0.5) {
		return excluir.probability >= 1 - thresholds.excluir
			? { lane: "descartado", reason: "excluido" }
			: { lane: "para_revisar", reason: "excluir_inseguro" };
	}

	// La confianza que manda es la mínima de las dimensiones que se usaron.
	const confianza = Math.min(encaje.confidence, rol.confidence);
	if (confianza < thresholds.confidence) {
		return { lane: "para_revisar", reason: "confianza_baja" };
	}

	if (encaje.score < thresholds.encaje) {
		return { lane: "descartado", reason: "encaje_bajo" };
	}
	if (rol.score < thresholds.rol) {
		return { lane: "descartado", reason: "rol_bajo" };
	}
	return { lane: "calificado", reason: "encaje_y_rol" };
}
