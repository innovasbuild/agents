// scripts/spike-jev.mts
// Spike S1/S2 (spec etapa 13 §12): forma real de la respuesta de evaluate()
// con typesafe-ai/jev por el AI Gateway. Se borra al cerrar E2.
import { experimental_evaluate as evaluate } from "ai";

const result = await evaluate({
	model: "typesafe-ai/jev",
	state: {
		persona: { nombre: "Laura Gómez", cargo: "Gerente General" },
		empresa: {
			nombre: "Acme",
			dominio: "acme.test",
			empleados: 120,
			rubro: "envases",
			ubicacion: "Rosario, Argentina",
		},
	},
	questions: {
		encaje_empresa: {
			type: "score",
			instructions: "¿Qué tan bien entra esta empresa en el ICP descrito?",
			criteria: [
				"No es del universo: rubro ajeno o tamaño fuera de rango",
				"Podría ser: entra en tamaño y geografía pero no se ve el problema",
				"Encaja: tamaño, rubro y señales de operación creciendo",
			],
		},
		excluir: {
			type: "boolean",
			instructions: "¿Es competidora, ya cliente, o proveedora nuestra?",
		},
	},
	providerOptions: { gateway: { zeroDataRetention: true } },
});

console.log("answers:", JSON.stringify(result.answers, null, 2));
console.log("usage:", JSON.stringify(result.usage));
console.log("providerMetadata:", JSON.stringify(result.providerMetadata, null, 2));
