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
			"La respuesta muestra un borrador de email en español rioplatense cuya primera línea después del saludo menciona que la empresa abrió una segunda planta en Rafaela, sin rayas ni signos de apertura.",
		);
	},
});
