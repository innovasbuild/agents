// Crédito de IA visto desde la app (página y acción del chat). Mismo cálculo
// que el hook de los agentes (aiAllowanceForChat); devuelve el motivo o null.
// Imports relativos: comparte módulo con código que eve empaqueta.
import { createAdminClient } from "../supabase/admin";
import { aiAllowanceForChat } from "./ai-allowance";
import type { LimitReason } from "./limits";
import { createPlanStore } from "./store";

export async function chatAiBlock(
	tenantId: string,
): Promise<LimitReason | null> {
	try {
		const result = await aiAllowanceForChat(
			{ tenantId },
			{ store: createPlanStore(createAdminClient()), now: () => new Date() },
		);
		return result.ok ? null : result.reason;
	} catch (error) {
		// Fail open, igual que el hook: sin lectura de facturación el chat sigue.
		console.error("chatAiBlock:", error);
		return null;
	}
}
