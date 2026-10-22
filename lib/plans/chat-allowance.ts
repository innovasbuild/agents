// Crédito de IA visto desde la app (página y acción del chat). Mismo cálculo
// que el hook de los agentes; acá devuelve el motivo del corte o null.
// Imports relativos: comparte módulo con código que eve empaqueta.
import { createAdminClient } from "../supabase/admin";
import { aiAllowance } from "./ai-allowance";
import type { LimitReason } from "./limits";
import { createPlanStore } from "./store";
import { tenantTimezone } from "./tenant-timezone";

export async function chatAiBlock(
	tenantId: string,
): Promise<LimitReason | null> {
	try {
		const admin = createAdminClient();
		const timezone = await tenantTimezone(admin, tenantId);
		const result = await aiAllowance(
			{ tenantId, timezone },
			{ store: createPlanStore(admin), now: () => new Date() },
		);
		return result.ok ? null : result.reason;
	} catch (error) {
		// Fail open, igual que el hook: sin lectura de facturación el chat sigue.
		console.error("chatAiBlock:", error);
		return null;
	}
}
