// TEMPORAL (spec 03 §13, spike S2): se borra cuando termine el spike.
// Pide el token de Google con gmail.send + gmail.readonly para que el chat
// muestre la tarjeta de autorización con el scope nuevo: el consentimiento sale
// del flujo del chat, no de una ruta GET. No lee ni manda mails: solo pide el
// token y reporta si quedó concedido.
import { defineTool } from "eve/tools";
import { z } from "zod";
import { tenantScopedConnect } from "../../../lib/connectors/auth";
import { hasEnabledBinding } from "../../../lib/connectors/bindings";
import { GOOGLE_CONNECTOR_UID } from "../../../lib/connectors/platform";
import { GMAIL_SEND_SCOPE } from "../../../lib/gmail/send";
import { refuse } from "../../../lib/outreach/result";
import { callerFromSession } from "../../../lib/outreach/session";
import { GMAIL_AUTH_OPTIONS } from "./send_email";

const GMAIL_READONLY_SCOPE = "https://www.googleapis.com/auth/gmail.readonly";

export default defineTool({
	description:
		"TEMPORAL (spike S2): pide autorizar Google con permiso de lectura de Gmail, además del de envío. No lee ni manda mails: solo dispara la autorización y avisa si quedó. Usala solo si el usuario la pide por nombre.",
	inputSchema: z.object({}),
	async execute(_input, ctx) {
		if (process.env.SPIKE_S2 !== "1") {
			return refuse("spike_apagado", "el spike S2 no está habilitado");
		}
		const caller = callerFromSession(ctx.session);
		if (!(await hasEnabledBinding(caller.tenantId, "mail", "gmail"))) {
			return refuse("sin_gmail", "este tenant no tiene Gmail habilitado");
		}
		const google = tenantScopedConnect(GOOGLE_CONNECTOR_UID, caller.tenantId, [
			GMAIL_SEND_SCOPE,
			GMAIL_READONLY_SCOPE,
		]);
		// getToken pausa el turno y muestra la tarjeta de autorización si el grant
		// no cubre los dos scopes. El token no se usa para nada más y nunca sale
		// de acá.
		await ctx.getToken(google, GMAIL_AUTH_OPTIONS);
		return {
			ok: true as const,
			message:
				"Google quedó autorizado con envío y lectura de Gmail. Ahora corré la ruta de diagnóstico del spike S2.",
		};
	},
});
