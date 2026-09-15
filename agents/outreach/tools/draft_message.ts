import { generateText, Output } from "ai";
import { defineTool } from "eve/tools";
import { z } from "zod";
import { brainForTenant, loadCanon } from "../../../lib/outreach/canon";
import { draftOutputSchema } from "../../../lib/outreach/prompt";
import { draftMessage } from "../../../lib/outreach/services/draft";
import { callerFromSession } from "../../../lib/outreach/session";
import { createSupabaseOutreachStore } from "../../../lib/outreach/store";
import { createAdminClient } from "../../../lib/supabase/admin";

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
				generate: async (model, prompt) => {
					const result = await generateText({
						model,
						prompt,
						maxOutputTokens: 1_200,
						maxRetries: 1,
						abortSignal: ctx.abortSignal,
						output: Output.object({ schema: draftOutputSchema }),
					});
					return { output: result.output, usage: result.usage };
				},
				now: () => new Date(),
			},
		);
	},
});
