import { defineTool } from "eve/tools";
import { always } from "eve/tools/approval";
import { z } from "zod";
import { tenantScopedConnect } from "../../../lib/connectors/auth";
import { hasEnabledBinding } from "../../../lib/connectors/bindings";
import { GOOGLE_CONNECTOR_UID } from "../../../lib/connectors/platform";
import {
	GMAIL_SEND_SCOPE,
	GmailUnauthorizedError,
	sendMail,
} from "../../../lib/gmail/send";
import { brainForTenant, loadCanon } from "../../../lib/outreach/canon";
import { crmForSession } from "../../../lib/outreach/crm-session";
import { refuse } from "../../../lib/outreach/result";
import { sendQueuedEmail } from "../../../lib/outreach/services/send";
import { callerFromSession } from "../../../lib/outreach/session";
import { createSupabaseOutreachStore } from "../../../lib/outreach/store";
import { createAdminClient } from "../../../lib/supabase/admin";

// authKey "gmail" es la identidad del flujo de autorización: la usa
// hooks/executors.ts para reconocer que se autorizó Gmail.
export const GMAIL_AUTH_OPTIONS = {
	authKey: "gmail",
	displayName: "Google",
} as const;

export default defineTool({
	description:
		"Envía por Gmail una pieza pendiente de la cola del ejecutor. Pasá queueItemId y exactamente el to, subject y body que devolvió list_queue. La tarjeta de aprobación de esta tool ES la confirmación del usuario: no pidas otra antes, ni por texto ni con ask_question. Si devuelve ok:false, citá el message.",
	inputSchema: z.object({
		queueItemId: z.uuid(),
		to: z.email(),
		subject: z.string().min(1).max(200),
		body: z.string().min(1).max(20_000),
	}),
	approval: always(),
	async execute(input, ctx) {
		const caller = callerFromSession(ctx.session);
		if (!(await hasEnabledBinding(caller.tenantId, "mail", "gmail"))) {
			return refuse("sin_gmail", "este tenant no tiene Gmail habilitado");
		}
		const gmail = tenantScopedConnect(GOOGLE_CONNECTOR_UID, caller.tenantId, [
			GMAIL_SEND_SCOPE,
		]);
		const { token } = await ctx.getToken(gmail, GMAIL_AUTH_OPTIONS);
		const [brain, crm] = await Promise.all([
			brainForTenant(caller.tenantId),
			crmForSession(ctx, caller.tenantId),
		]);
		try {
			return await sendQueuedEmail(
				{ caller, sessionId: ctx.session.id, callId: ctx.callId, ...input },
				{
					store: createSupabaseOutreachStore(createAdminClient()),
					crm: crm?.adapter ?? null,
					crmAfterSend: crm?.raw ?? null,
					loadCanon: (slug) => loadCanon(brain, slug),
					sendMail: (mail) => sendMail(token, mail),
					isMailUnauthorized: (error) =>
						error instanceof GmailUnauthorizedError,
					now: () => new Date(),
				},
			);
		} catch (error) {
			if (error instanceof GmailUnauthorizedError)
				ctx.requireAuth(gmail, GMAIL_AUTH_OPTIONS);
			throw error;
		}
	},
});
