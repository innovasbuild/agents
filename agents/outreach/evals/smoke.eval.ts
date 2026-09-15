import { defineEval } from "eve/evals";
import { resetEvalTenant } from "./support";

export default defineEval({
	description:
		"El agente responde con la auth de eval y no envía nada sin que se lo pidan.",
	async test(t) {
		await resetEvalTenant();
		await t.send("Hola, contame en una línea qué podés hacer.");
		t.succeeded();
		t.notCalledTool("send_email");
	},
});
