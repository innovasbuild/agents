import { defineEval } from "eve/evals";

export default defineEval({
	description: "El asistente responde con la auth de eval.",
	async test(t) {
		await t.send("Hola, contame en una línea qué podés hacer.");
		t.succeeded();
	},
});
