import { defineTool } from "eve/tools";
import { z } from "zod";
import { MODEL_LOGGABLE_EVENT_TYPES } from "../../../lib/outreach/events";
import { logModelEvent } from "../../../lib/outreach/services/crm-record";
import { callerFromSession } from "../../../lib/outreach/session";
import { createSupabaseOutreachStore } from "../../../lib/outreach/store";
import { createAdminClient } from "../../../lib/supabase/admin";

export default defineTool({
	description:
		"Deja constancia en el registro de la plataforma de un freno (citá cuál de los cinco aplica) o de una nota operativa. No escribe en el CRM.",
	inputSchema: z.object({
		type: z.enum(MODEL_LOGGABLE_EVENT_TYPES),
		contactKey: z.string().min(4).max(300).nullable(),
		summary: z.string().min(1).max(500),
	}),
	async execute(input, ctx) {
		return logModelEvent(
			{ ...input, caller: callerFromSession(ctx.session) },
			{ store: createSupabaseOutreachStore(createAdminClient()) },
		);
	},
});
