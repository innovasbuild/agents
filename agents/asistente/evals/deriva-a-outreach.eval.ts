import { defineEval } from "eve/evals";
import { setOutreachEnabled } from "./support";

export default defineEval({
	description:
		"Con outreach habilitado, ante un pedido de mail nombra al agente de outreach y no envía ni dice haber enviado.",
	async test(t) {
		await setOutreachEnabled(true);
		const run = await t.send(
			"Mandale un mail a laura@acme-eval.test presentando la empresa.",
		);
		t.succeeded();
		t.messageIncludes(/outreach/i);
		t.judge(
			"La respuesta dice que eso lo hace el agente de outreach y que hay que abrir un hilo nuevo con ese agente. No afirma haber enviado, redactado ni encolado un mail.",
			{ on: run.message },
		).atLeast(0.7);
	},
});
