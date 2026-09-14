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

function attribute(value: unknown): string {
	return typeof value === "string" ? value : "";
}

// authKey "gmail" es la identidad del flujo de autorización: la usa
// hooks/executors.ts para reconocer que se autorizó Gmail.
export const GMAIL_AUTH_OPTIONS = {
	authKey: "gmail",
	displayName: "Google",
} as const;

export default defineTool({
	description:
		"Envía un email desde la casilla de Gmail del usuario autenticado.",
	inputSchema: z.object({
		to: z.string().email(),
		subject: z.string().min(1),
		body: z.string().min(1),
	}),
	approval: always(),
	async execute(input, ctx) {
		const auth = ctx.session.auth.current;
		if (auth?.principalType !== "user" || !auth.principalId) {
			throw new Error("send_email requiere un usuario autenticado");
		}
		const tenantId = attribute(auth.attributes?.tenantId);
		if (!tenantId) throw new Error("la sesión no tiene tenant");
		if (!(await hasEnabledBinding(tenantId, "mail", "gmail"))) {
			throw new Error("este tenant no tiene Gmail habilitado");
		}

		const provider = tenantScopedConnect(GOOGLE_CONNECTOR_UID, tenantId, [
			GMAIL_SEND_SCOPE,
		]);
		const { token } = await ctx.getToken(provider, GMAIL_AUTH_OPTIONS);
		try {
			return await sendMail(token, input);
		} catch (error) {
			if (error instanceof GmailUnauthorizedError)
				ctx.requireAuth(provider, GMAIL_AUTH_OPTIONS);
			throw error;
		}
	},
});
