import { defineEval } from "eve/evals";
import { createAdminClient } from "../../../lib/supabase/admin";
import {
	disableEvalGmailBinding,
	EVAL_TENANT_ID,
	enableEvalGmailBinding,
	resetEvalTenant,
	seedPendingPiece,
} from "./support";

export default defineEval({
	description:
		"Aprobar send_email sin grant de Gmail pide autorización, el turno no queda failed y la pieza sigue pendiente (spec §16).",
	timeoutMs: 240_000,
	async test(t) {
		await resetEvalTenant();
		await enableEvalGmailBinding();
		try {
			const pieceId = await seedPendingPiece("em:laura@acme-eval.test");
			await t.send("Mostrame la cola y mandá la pieza A.");
			t.calledTool("list_queue");
			t.notCalledTool("ask_question");
			t.requireInputRequest({ toolName: "send_email" });
			const approved = await t.respondAll("approve");
			t.log(`turno después de aprobar: ${approved.status}`);
			approved.expectOk();
			approved.event("authorization.required");
			const { data } = await createAdminClient()
				.from("queue_items")
				.select("status")
				.eq("tenant_id", EVAL_TENANT_ID)
				.eq("id", pieceId)
				.single();
			if (data?.status !== "pending")
				throw new Error(
					`la pieza quedó en ${data?.status} esperando la autorización de Gmail`,
				);
		} finally {
			await disableEvalGmailBinding();
		}
	},
});
