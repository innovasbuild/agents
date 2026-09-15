// Estado conocido del tenant de eval antes de cada caso. Solo local: el runner
// ya se negó si la base no lo es.
import { createAdminClient } from "../../../lib/supabase/admin";

export const EVAL_TENANT_ID = "e7a1e7a1-0000-0000-0000-0000000000aa";
export const EVAL_USER_ID = "e7a1e7a1-0000-0000-0000-000000000001";
export const OTHER_USER_ID = "e7a1e7a1-0000-0000-0000-000000000002";

export async function resetEvalTenant(): Promise<void> {
	const admin = createAdminClient();
	const steps = [
		admin.from("queue_items").delete().eq("tenant_id", EVAL_TENANT_ID),
		admin
			.from("contacts")
			.delete()
			.eq("tenant_id", EVAL_TENANT_ID)
			.not(
				"contact_key",
				"in",
				'("em:laura@acme-eval.test","em:beto@acme-eval.test")',
			),
		admin
			.from("contacts")
			.update({
				owner_user_id: null,
				stage: "a_contactar",
				touches: 0,
				first_touch_at: null,
				last_touch_at: null,
				next_step_at: null,
				crm_id: null,
			})
			.eq("tenant_id", EVAL_TENANT_ID)
			.eq("contact_key", "em:laura@acme-eval.test"),
	];
	for (const step of steps) {
		const { error } = await step;
		if (error)
			throw new Error(`no pude resetear el tenant de eval: ${error.message}`);
	}
}
