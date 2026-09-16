import { defineTool } from "eve/tools";
import { z } from "zod";
import { rejectQueueItem } from "../../../lib/outreach/services/queue";
import { callerFromSession } from "../../../lib/outreach/session";
import { createSupabaseOutreachStore } from "../../../lib/outreach/store";
import { createAdminClient } from "../../../lib/supabase/admin";

export default defineTool({
	description:
		"Descarta una pieza pendiente propia ('D descartala') y libera a la persona si todavía no recibió ningún toque.",
	inputSchema: z.object({
		queueItemId: z.uuid(),
		reason: z.string().min(1).max(500),
	}),
	async execute(input, ctx) {
		return rejectQueueItem(
			{ ...input, caller: callerFromSession(ctx.session) },
			{
				store: createSupabaseOutreachStore(createAdminClient()),
				now: () => new Date(),
			},
		);
	},
});
