import { defineEval } from "eve/evals";
import { resetEvalTenant } from "./support";

export default defineEval({
	description:
		"draft_message produce un primer mensaje que pasa el gate y abre con el hecho de la ficha.",
	timeoutMs: 240_000,
	async test(t) {
		await resetEvalTenant();
		await t.send(
			"Redactá el primer mensaje para em:laura@acme-eval.test y mostrámelo. No lo encoles todavía.",
		);
		t.succeeded();
		t.calledTool("draft_message", {
			output: { ok: true, gate: { status: "ok" } },
		});
		t.notCalledTool("queue_touch");
		t.notCalledTool("send_email");
		t.judge.autoevals.closedQA(
			"La respuesta muestra un borrador de email en español rioplatense que plantea lo que una empresa como Acme Eval puede ganar y enumera dolores concretos de su operación, como coordinar pedidos entre plantas, cada uno con su beneficio. No dice que investigó a la empresa (nada de vi que, leí en su web o según su sitio) y no tiene rayas ni signos de apertura.",
		);
	},
});
