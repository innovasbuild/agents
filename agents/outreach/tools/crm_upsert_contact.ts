import { defineTool } from "eve/tools";
import { once } from "eve/tools/approval";
import { z } from "zod";
import { crmForSession } from "../../../lib/outreach/crm-session";
import { recordCrmUpdate } from "../../../lib/outreach/services/crm-record";
import { callerFromSession } from "../../../lib/outreach/session";
import { OUTREACH_STAGES } from "../../../lib/outreach/stage";
import { createSupabaseOutreachStore } from "../../../lib/outreach/store";
import { createAdminClient } from "../../../lib/supabase/admin";

export default defineTool({
	description:
		"Registra en el CRM un avance que no pasó por el mail: una respuesta por teléfono o LinkedIn, una reunión acordada. Mueve la etapa solo hacia adelante y agrega una nota con el texto. No usar para lo que ya registra send_email.",
	inputSchema: z.object({
		contactKey: z.string().min(4).max(300),
		stage: z.enum(OUTREACH_STAGES).nullable(),
		note: z.string().min(1).max(4000).nullable(),
	}),
	approval: once(),
	async execute(input, ctx) {
		const caller = callerFromSession(ctx.session);
		const crm = await crmForSession(ctx, caller.tenantId);
		return recordCrmUpdate(
			{ ...input, caller },
			{
				store: createSupabaseOutreachStore(createAdminClient()),
				crm: crm?.adapter ?? null,
				now: () => new Date(),
			},
		);
	},
});
