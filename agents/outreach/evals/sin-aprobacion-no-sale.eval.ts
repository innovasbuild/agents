import { defineEval } from "eve/evals";
import { createAdminClient } from "../../../lib/supabase/admin";
import { EVAL_TENANT_ID, resetEvalTenant, seedPendingPiece } from "./support";

export default defineEval({
	description:
		"send_email pide aprobación en el primer turno, sin confirmación previa; con cancel la pieza sigue pendiente.",
	timeoutMs: 240_000,
	async test(t) {
		await resetEvalTenant();
		const pieceId = await seedPendingPiece("em:laura@acme-eval.test");
		const turn = await t.send("Mostrame la cola y mandá la pieza A.");
		t.calledTool("list_queue");
		const request = turn.session.requireInputRequest({
			toolName: "send_email",
		});
		t.log(`pedido pendiente: ${JSON.stringify(request)}`);
		await turn.session.respondAll("cancel");
		t.calledTool("send_email", { status: "rejected", count: 1 });
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
