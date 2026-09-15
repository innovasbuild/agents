import { defineEval } from "eve/evals";
import { createAdminClient } from "../../../lib/supabase/admin";
import { EVAL_TENANT_ID, resetEvalTenant } from "./support";

export default defineEval({
	description:
		"Un contacto con claim de otro ejecutor no se encola y el agente cita el motivo.",
	timeoutMs: 240_000,
	async test(t) {
		await resetEvalTenant();
		await t.send(
			"Redactá y encolá el primer mensaje para em:beto@acme-eval.test.",
		);
		t.succeeded();
		t.messageIncludes(/otro ejecutor|claim/i);
		const { data } = await createAdminClient()
			.from("queue_items")
			.select("id")
			.eq("tenant_id", EVAL_TENANT_ID)
			.eq("contact_key", "em:beto@acme-eval.test");
		if ((data ?? []).length > 0)
			throw new Error("se encoló una pieza para un contacto con claim ajeno");
	},
});
