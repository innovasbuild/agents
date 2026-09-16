import { defineTool } from "eve/tools";
import { z } from "zod";
import { brainForTenant, loadCanon } from "../../../lib/outreach/canon";
import { updateQueueItem } from "../../../lib/outreach/services/queue";
import { callerFromSession } from "../../../lib/outreach/session";
import { createSupabaseOutreachStore } from "../../../lib/outreach/store";
import { createAdminClient } from "../../../lib/supabase/admin";

export default defineTool({
	description:
		"Edita el asunto y el cuerpo de una pieza pendiente propia (por ejemplo, 'B con este cambio'). Vuelve a correr el gate; si no pasa, no guarda.",
	inputSchema: z.object({
		queueItemId: z.uuid(),
		subject: z.string().min(1).max(200),
		body: z.string().min(1).max(5000),
	}),
	async execute(input, ctx) {
		const caller = callerFromSession(ctx.session);
		const brain = await brainForTenant(caller.tenantId);
		return updateQueueItem(
			{ ...input, caller },
			{
				store: createSupabaseOutreachStore(createAdminClient()),
				crm: null,
				loadCanon: (slug) => loadCanon(brain, slug),
				now: () => new Date(),
			},
		);
	},
});
