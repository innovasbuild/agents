import { defineEval } from "eve/evals";

// Si el resolver de agents/asistente/tools/brain.ts falla, eve lo descarta con
// un log y el agente queda sin su única capacidad: ninguna otra eval lo nota.
export default defineEval({
	description:
		"Ante una pregunta sobre la empresa busca y lee el brain antes de contestar, y nombra la página.",
	async test(t) {
		const run = await t.send("¿A qué tipo de empresas le vendemos?");
		t.succeeded();
		t.calledTool("brain_search", { output: { ok: true } });
		t.calledTool("brain_read", { output: { ok: true } });
		t.judge(
			"La respuesta dice que se le vende a empresas industriales medianas de Argentina y nombra la página del brain de donde lo sacó (ICP o comercial/icp).",
			{ on: run.message },
		).atLeast(0.7);
	},
});
