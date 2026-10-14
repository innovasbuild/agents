// Estado del tenant de eval para las evals del asistente. Solo local: el
// runner ya se negó si la base no lo es.
import { createAdminClient } from "../../../lib/supabase/admin";

const EVAL_TENANT_ID = "e7a1e7a1-0000-0000-0000-0000000000aa";

/** Prende o apaga outreach en el tenant de eval. Quien apaga, vuelve a prender. */
export async function setOutreachEnabled(enabled: boolean): Promise<void> {
	const { error } = await createAdminClient()
		.from("tenant_agents")
		.update({ enabled })
		.eq("tenant_id", EVAL_TENANT_ID)
		.eq("agent", "outreach");
	if (error) {
		throw new Error(
			`no pude cambiar outreach en el tenant de eval: ${error.message}`,
		);
	}
}
