import { defineTool } from "eve/tools";
import { z } from "zod";
import { brainForTenant, loadCanon } from "../../../lib/outreach/canon";
import { crmForSession } from "../../../lib/outreach/crm-session";
import { queueTouch } from "../../../lib/outreach/services/queue";
import { callerFromSession } from "../../../lib/outreach/session";
import { createSupabaseOutreachStore } from "../../../lib/outreach/store";
import { createAdminClient } from "../../../lib/supabase/admin";

export default defineTool({
	description:
		"Encola un primer mensaje ya redactado (draft_message) como pieza pendiente del ejecutor. Vuelve a correr el gate, chequea el claim y reserva a la persona. No envía: la pieza sale solo con send_email y la aprobación del usuario.",
	inputSchema: z.object({
		contactKey: z.string().min(4).max(300),
		kind: z.enum(["msg1"]),
		subject: z.string().min(1).max(200),
		body: z.string().min(1).max(5000),
		hook: z.string().min(1),
		vector: z.string().min(1),
		idioma: z.string().min(1),
		ancla: z.object({ hecho: z.string().min(1), fuente: z.string().min(1) }),
	}),
	async execute(input, ctx) {
		const caller = callerFromSession(ctx.session);
		const [brain, crm] = await Promise.all([
			brainForTenant(caller.tenantId),
			crmForSession(ctx, caller.tenantId),
		]);
		return queueTouch(
			{ ...input, caller },
			{
				store: createSupabaseOutreachStore(createAdminClient()),
				crm: crm?.adapter ?? null,
				loadCanon: (slug) => loadCanon(brain, slug),
				now: () => new Date(),
			},
		);
	},
});
