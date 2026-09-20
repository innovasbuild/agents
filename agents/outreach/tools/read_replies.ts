import { defineTool } from "eve/tools";
import { z } from "zod";
import { listReplies } from "../../../lib/outreach/services/replies";
import { callerFromSession } from "../../../lib/outreach/session";
import { createSupabaseOutreachStore } from "../../../lib/outreach/store";
import { createAdminClient } from "../../../lib/supabase/admin";

export default defineTool({
	description:
		"Trae, sin interpretar, las respuestas de contactos del tenant que siguen en respuesta_neutra: todavía no se clasificaron. Usala antes de decidir si cada una es interés, reunión, baja o ambigua.",
	inputSchema: z.object({}),
	async execute(_input, ctx) {
		return listReplies(
			{ caller: callerFromSession(ctx.session) },
			{ store: createSupabaseOutreachStore(createAdminClient()) },
		);
	},
});
