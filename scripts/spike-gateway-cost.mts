// scripts/spike-gateway-cost.mts
// Spike S1 (spec orquestación §13): ¿el AI Gateway informa el costo de cada
// llamada en providerMetadata? Se corre a mano, una vez. No es código de
// producción: se borra al cerrar la E1.
import { generateText } from "ai";

const result = await generateText({
	model: "anthropic/claude-haiku-4.5",
	prompt: "Respondé solo: ok",
	maxOutputTokens: 16,
});

const gateway = (result.providerMetadata as Record<string, unknown> | undefined)
	?.gateway as Record<string, unknown> | undefined;

console.log("usage:", JSON.stringify(result.usage));
console.log(
	"providerMetadata keys:",
	Object.keys(result.providerMetadata ?? {}),
);
console.log("gateway keys:", Object.keys(gateway ?? {}));
console.log("gateway.cost:", gateway?.cost, typeof gateway?.cost);
