import { defineEval } from "eve/evals";
import { resetEvalTenant } from "./support";

// Prueba de punta a punta de que eve acepta las tools dinámicas del brain.
// Si el resolver de agents/outreach/tools/brain.ts falla (por ejemplo, un
// schema o callback sin descriptor durable), eve lo descarta con un log y el
// agente sigue sin brain_*: ninguna otra eval lo notaría.
export default defineEval({
	description:
		"brain_search, brain_read y brain_upsert existen y corren en el agente compilado; brain_upsert pide aprobación.",
	timeoutMs: 240_000,
	async test(t) {
		await resetEvalTenant();
		const first = await t.send(
			"Buscá en el brain la página del ICP y leela completa. Decime en una línea qué dice.",
		);
		t.calledTool("brain_search", { output: { ok: true } });
		t.calledTool("brain_read", { output: { ok: true } });

		await first.session.send(
			"Creá en el brain una página nueva comercial/prueba-eval, categoría comercial, estado borrador, sin tags, con el cuerpo 'Prueba de eval.' y como motivo 'eval de tools'.",
		);
		first.session.requireInputRequest({ toolName: "brain_upsert" });
		await first.session.respondAll("cancel");
		t.calledTool("brain_upsert", { status: "rejected", count: 1 });
	},
});
