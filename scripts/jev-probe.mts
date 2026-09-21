// Prueba de Jev (TypeSafe System One) por fetch directo al AI Gateway. Uso:
//   npm run jev:probe -- ["texto a evaluar"]
const ENDPOINT = "https://ai-gateway.vercel.sh/typesafe/v1/systemone";

const DEFAULT_STATE =
	"Hola, vi lo de En Paralelo. Me interesa, ¿podemos hablar la semana que viene?";

async function main(): Promise<void> {
	const key = process.env.AI_GATEWAY_API_KEY;
	if (!key) throw new Error("falta AI_GATEWAY_API_KEY en .env.local");
	const state = process.argv[2] ?? DEFAULT_STATE;

	const startedAt = performance.now();
	const response = await fetch(ENDPOINT, {
		method: "POST",
		headers: {
			Authorization: `Bearer ${key}`,
			"Content-Type": "application/json",
		},
		body: JSON.stringify({
			model: "typesafe-ai/jev",
			state,
			questions: {
				has_interest: {
					type: "noul",
					instructions:
						"Does the sender express interest in continuing the conversation?",
				},
				intent: {
					type: "choice",
					instructions: "What is the sender's main intent?",
					criteria: {
						meeting: "Wants to schedule a call or meeting",
						question: "Asks for more information before deciding",
						rejection: "Declines or asks not to be contacted",
						other: "None of the above",
					},
				},
			},
		}),
	});
	const elapsedMs = Math.round(performance.now() - startedAt);
	const body = await response.text();
	if (!response.ok)
		throw new Error(`el gateway respondió ${response.status}: ${body}`);

	const { answers, usage, provider_metadata } = JSON.parse(body);
	console.log(`state: ${state}`);
	console.log(JSON.stringify(answers, null, 2));
	console.log(
		`${elapsedMs} ms · ${usage.input_tokens} tokens de entrada · costo ${provider_metadata?.gateway?.cost ?? "?"}`,
	);
}

main().catch((error: unknown) => {
	console.error(error instanceof Error ? error.message : error);
	process.exit(1);
});
