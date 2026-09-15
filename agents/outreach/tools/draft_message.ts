import { generateText, NoObjectGeneratedError, Output } from "ai";
import { defineTool } from "eve/tools";
import { z } from "zod";
import { brainForTenant, loadCanon } from "../../../lib/outreach/canon";
import { draftOutputSchema } from "../../../lib/outreach/prompt";
import { draftMessage } from "../../../lib/outreach/services/draft";
import { callerFromSession } from "../../../lib/outreach/session";
import { createSupabaseOutreachStore } from "../../../lib/outreach/store";
import { createAdminClient } from "../../../lib/supabase/admin";

/**
 * Llama al modelo y devuelve el objeto que espera `draftMessage`. Extraída del
 * `execute` de la tool (y con `generateText` inyectado) para poder probarla
 * sin llamar al modelo real.
 *
 * `generateText` con `Output.object` valida el esquema y, si el JSON viene
 * roto, no cierra o se corta por `maxOutputTokens`, tira `NoObjectGeneratedError`
 * en vez de resolver (ai@7.0.98, ver node_modules/ai/dist/index.js). Ese fallo
 * cuenta como un intento fallido, no como una excepción: si el texto crudo del
 * error resulta parseable devolvemos ese objeto (`draftOutputSchema.safeParse`
 * en draftMessage lo va a rechazar si no cumple el esquema), y si no, `null`.
 * Cualquier otro error se relanza.
 */
export async function generateDraft(
	model: string,
	system: string,
	prompt: string,
	deps: { generateText: typeof generateText; abortSignal?: AbortSignal },
): Promise<{ output: unknown; usage: unknown }> {
	try {
		const result = await deps.generateText({
			model,
			system,
			prompt,
			maxOutputTokens: 1_200,
			maxRetries: 1,
			abortSignal: deps.abortSignal,
			output: Output.object({ schema: draftOutputSchema }),
		});
		return { output: result.output, usage: result.usage };
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
			return { output, usage: error.usage ?? null };
		}
		throw error;
	}
}

// Sin approval: no escribe en ningún lado. El costo de Opus se acota con
// maxOutputTokens y a lo sumo 3 intentos.
export default defineTool({
	description:
		"Redacta el primer mensaje por email para un contacto cargado, con la ficha de su cuenta y el canon del cliente, y lo pasa por el gate de estilo (hasta 3 intentos). No encola ni envía: con la pieza aprobada por el gate, usá queue_touch.",
	inputSchema: z.object({
		contactKey: z.string().min(4).max(300),
		kind: z.enum(["msg1"]),
	}),
	async execute({ contactKey, kind }, ctx) {
		const caller = callerFromSession(ctx.session);
		const brain = await brainForTenant(caller.tenantId);
		return draftMessage(
			{ caller, contactKey, kind },
			{
				store: createSupabaseOutreachStore(createAdminClient()),
				loadCanon: (slug) => loadCanon(brain, slug),
				generate: (model, system, prompt) =>
					generateDraft(model, system, prompt, {
						generateText,
						abortSignal: ctx.abortSignal,
					}),
				now: () => new Date(),
			},
		);
	},
});
