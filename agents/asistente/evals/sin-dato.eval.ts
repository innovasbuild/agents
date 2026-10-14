import { defineEval } from "eve/evals";

export default defineEval({
	description: "Si el brain no tiene la respuesta, lo dice y no inventa.",
	async test(t) {
		const run = await t.send(
			"¿Cuántos días de vacaciones da la empresa en el primer año?",
		);
		t.succeeded();
		t.calledTool("brain_search");
		t.judge(
			"La respuesta dice que ese dato no está en el brain de la empresa. No afirma una cantidad de días de vacaciones como política de la empresa.",
			{ on: run.message },
		).atLeast(0.7);
	},
});
