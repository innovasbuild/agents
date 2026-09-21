import { generateText } from "ai";
import { defineTool } from "eve/tools";
import { z } from "zod";
import { brainForTenant, loadCanon } from "../../../lib/outreach/canon";
import { draftMessage } from "../../../lib/outreach/services/draft";
import { generateDraft } from "../../../lib/outreach/services/generate-draft";
import { callerFromSession } from "../../../lib/outreach/session";
import { createSupabaseOutreachStore } from "../../../lib/outreach/store";
import { createAdminClient } from "../../../lib/supabase/admin";
import {
	createUsageRecorder,
	metered,
	resolveRunId,
} from "../../../lib/workflows/usage";

// Sin approval: no escribe en ningún lado salvo su asiento de consumo. El
// costo de Opus se acota con maxOutputTokens y a lo sumo 3 intentos.
export default defineTool({
	description:
		"Redacta el primer mensaje por email para un contacto cargado, con la ficha de su cuenta y el canon del cliente, y lo pasa por el gate de estilo (hasta 3 intentos). No encola ni envía: con la pieza aprobada por el gate, usá queue_touch.",
	inputSchema: z.object({
		contactKey: z.string().min(4).max(300),
		kind: z.enum(["msg1"]),
	}),
	async execute({ contactKey, kind }, ctx) {
		const caller = callerFromSession(ctx.session);
		const admin = createAdminClient();
		const brain = await brainForTenant(caller.tenantId);
		// `turn.id` es el mismo que hooks/runs.ts guarda en runs.eve_turn_id.
		const runId = await resolveRunId(
			admin,
			ctx.session.id,
			ctx.session.turn.id,
		);
		return draftMessage(
			{ caller, contactKey, kind },
			{
				store: createSupabaseOutreachStore(admin),
				loadCanon: (slug) => loadCanon(brain, slug),
				generate: metered(
					(model: string, system: string, prompt: string) =>
						generateDraft(model, system, prompt, {
							generateText,
							abortSignal: ctx.abortSignal,
						}),
					{
						model: (model) => model,
						record: createUsageRecorder(admin),
						base: {
							tenantId: caller.tenantId,
							runId,
							workflow: null,
							node: "outreach/draft",
						},
					},
				),
				now: () => new Date(),
			},
		);
	},
});
