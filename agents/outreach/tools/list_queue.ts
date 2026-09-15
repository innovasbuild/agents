import { defineTool } from "eve/tools";
import { z } from "zod";
import { listQueue } from "../../../lib/outreach/services/queue";
import { callerFromSession } from "../../../lib/outreach/session";
import { createSupabaseOutreachStore } from "../../../lib/outreach/store";
import { createAdminClient } from "../../../lib/supabase/admin";

export default defineTool({
	description:
		"Lista las piezas pendientes del ejecutor, con letra (A, B, C…), destinatario, asunto y cuerpo. Usala para mostrar la cola por letras antes de pedir qué hacer con cada una.",
	inputSchema: z.object({}),
	async execute(_input, ctx) {
		return listQueue(
			{ caller: callerFromSession(ctx.session) },
			{ store: createSupabaseOutreachStore(createAdminClient()) },
		);
	},
});
