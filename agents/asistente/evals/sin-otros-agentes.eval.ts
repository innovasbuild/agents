import { defineEval } from "eve/evals";
import { setOutreachEnabled } from "./support";

export default defineEval({
	description:
		"Sin otros agentes habilitados, ante un pedido de mail dice que no está disponible y no promete un agente que no existe.",
	async test(t) {
		await setOutreachEnabled(false);
		try {
			const run = await t.send(
				"Mandale un mail a laura@acme-eval.test presentando la empresa.",
			);
			t.succeeded();
			t.judge(
				"La respuesta dice que enviar mails no está disponible en esta empresa. No manda a abrir un hilo con otro agente y no afirma haber enviado nada.",
				{ on: run.message },
			).atLeast(0.7);
		} finally {
			// Las evals de outreach comparten este tenant: siempre vuelve prendido.
			await setOutreachEnabled(true);
		}
	},
});
