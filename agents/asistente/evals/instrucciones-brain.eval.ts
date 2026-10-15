import { defineEval } from "eve/evals";

// Criterio de cierre 2 de la etapa 26 en el chat: las instrucciones del brain
// llegan en session.started, sin que el agente las busque.
export default defineEval({
	description:
		"Nombra las instrucciones del brain sin haber llamado a ninguna tool.",
	async test(t) {
		const run = await t.send(
			"¿Qué instrucciones del brain tenés que seguir al escribir en esta empresa?",
		);
		t.succeeded();
		t.notCalledTool("brain_search");
		t.notCalledTool("brain_read");
		t.notCalledTool("brain_rules");
		t.judge(
			"La respuesta dice que las páginas se escriben en tercera persona y que las fechas van en formato AAAA-MM-DD, o algo equivalente.",
			{ on: run.message },
		).atLeast(0.7);
	},
});
