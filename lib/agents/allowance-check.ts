// Corte por crédito de IA al arrancar un turno del chat (spec etapa 27 §3 y
// §5.5). Lógica pura: el hook de eve le inyecta las dependencias reales.
// Imports relativos y sin next/*: lo importan hooks que eve empaqueta.

import type { aiAllowance } from "../plans/ai-allowance";
import type { LimitReason } from "../plans/limits";
import type { PlanStore } from "../plans/store";

export const ALLOWANCE_ERROR_PREFIX = "ai_allowance:";

export async function checkTurnAllowance(
	input: { tenantId: string | null; timezone: string },
	deps: { allowance: typeof aiAllowance; store: PlanStore; now: () => Date },
): Promise<void> {
	if (!input.tenantId) return;

	let result: Awaited<ReturnType<typeof aiAllowance>>;
	try {
		result = await deps.allowance(
			{ tenantId: input.tenantId, timezone: input.timezone },
			{ store: deps.store, now: deps.now },
		);
	} catch (error) {
		// Fail open a propósito: una caída de la lectura de facturación no puede
		// tumbar el chat de todas las empresas. Se loguea para enterarse.
		console.error("allowance check:", error);
		return;
	}

	if (!result.ok) throw new Error(`${ALLOWANCE_ERROR_PREFIX}${result.reason}`);
}

/**
 * Motivo del corte a partir del mensaje de un turn.failed, o null si el fallo
 * es otro. El mensaje puede venir envuelto por eve: se busca el prefijo.
 */
export function allowanceReasonFrom(
	message: string | null | undefined,
): LimitReason | null {
	const match = message?.match(
		/ai_allowance:(limit:ai_credit|suspended:(?:trial_vencido|pago_fallido|cancelado))/,
	);
	return match ? (match[1] as LimitReason) : null;
}
