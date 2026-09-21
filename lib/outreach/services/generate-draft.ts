// La llamada al modelo de la redacción. Vivía en la tool draft_message y la
// importaba también el schedule de follow-ups: un nodo escondido en una puerta
// (spec orquestación §9.4). Imports relativos: lo usan módulos de eve.
import { type generateText, NoObjectGeneratedError, Output } from "ai";
import { attachSpend, createStepSpend } from "../../workflows/usage";
import { draftOutputSchema } from "../prompt";

/**
 * Llama al modelo y devuelve el objeto que espera `draftMessage`, con
 * `generateText` inyectado para poder probarla sin llamar al modelo real.
 *
 * `generateText` con `Output.object` valida el esquema y, si el JSON viene
 * roto, no cierra o se corta por `maxOutputTokens`, tira `NoObjectGeneratedError`
 * en vez de resolver (ai@7.0.98, ver node_modules/ai/dist/index.js). Ese fallo
 * cuenta como un intento fallido, no como una excepción: si el texto crudo del
 * error resulta parseable devolvemos ese objeto (`draftOutputSchema.safeParse`
 * en draftMessage lo va a rechazar si no cumple el esquema), y si no, `null`.
 * Cualquier otro error se relanza.
 *
 * `usage` y `providerMetadata` viajan para que la puerta asiente el consumo
 * con `metered`: un intento fallido también se pagó. Si tira por otra cosa
 * (abort, error del proveedor) después de cerrar algún paso, ese consumo va
 * colgado del error con `attachSpend` y `metered` lo asienta antes de que se
 * relance.
 */
export async function generateDraft(
	model: string,
	system: string,
	prompt: string,
	deps: { generateText: typeof generateText; abortSignal?: AbortSignal },
): Promise<{ output: unknown; usage: unknown; providerMetadata: unknown }> {
	const steps = createStepSpend();
	try {
		const result = await deps.generateText({
			model,
			system,
			prompt,
			maxOutputTokens: 1_200,
			maxRetries: 1,
			abortSignal: deps.abortSignal,
			output: Output.object({ schema: draftOutputSchema }),
			onStepEnd: steps.onStepEnd,
		});
		return {
			output: result.output,
			usage: result.usage,
			providerMetadata: result.providerMetadata,
		};
	} catch (error) {
		if (NoObjectGeneratedError.isInstance(error)) {
			let output: unknown = null;
			if (error.text) {
				try {
					output = JSON.parse(error.text);
				} catch {
					output = null;
				}
			}
			return {
				output,
				usage: error.usage ?? null,
				providerMetadata: undefined,
			};
		}
		throw attachSpend(error, steps.spend());
	}
}
