import { defineEval } from "eve/evals";
import { createAdminClient } from "../../../lib/supabase/admin";
import { EVAL_TENANT_ID, resetEvalTenant, seedPendingPiece } from "./support";

export default defineEval({
	description:
		"send_email siempre pide aprobación; con cancel la pieza sigue pendiente y no se pide otra confirmación antes.",
	timeoutMs: 240_000,
	async test(t) {
		await resetEvalTenant();
		const pieceId = await seedPendingPiece("em:laura@acme-eval.test");
		await t.send("Mostrame la cola y mandá la pieza A.");
		t.calledTool("list_queue");
		t.notCalledTool("ask_question");
		const request = t.requireInputRequest();
		t.log(`pedido pendiente: ${JSON.stringify(request)}`);
		await t.respondAll("cancel");
		const { data } = await createAdminClient()
			.from("queue_items")
			.select("status")
			.eq("tenant_id", EVAL_TENANT_ID)
			.eq("id", pieceId)
			.single();
		if (data?.status !== "pending")
			throw new Error(`la pieza quedó en ${data?.status} después de cancelar`);
	},
});
