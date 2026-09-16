// Las dependencias de los servicios de outreach, armadas fuera de eve.
// El espejo de agents/outreach/tools/send_email.ts: mismos servicios, misma
// identidad, pero sin ctx. La diferencia que importa es requireAuth: una tool
// pausa el turno y muestra la tarjeta de autorización; una server action no
// puede pausar, así que lanza y la action traduce el error a un link.
import {
	isConnectAuthError,
	isConnectorNotInstalledError,
	tokenForSubject,
} from "@/lib/connectors/auth";
import { hasEnabledBinding } from "@/lib/connectors/bindings";
import {
	GOOGLE_CONNECTOR_UID,
	HUBSPOT_CONNECTOR_UID,
} from "@/lib/connectors/platform";
import {
	GMAIL_SCOPES,
	GmailUnauthorizedError,
	GmailUnknownOutcomeError,
	sendMail,
} from "@/lib/gmail/send";
import { createAdminClient } from "@/lib/supabase/admin";
import { brainForTenant, loadCanon } from "./canon";
import { crmForSession } from "./crm-session";
import type { QueueDeps } from "./services/queue";
import type { SendDeps } from "./services/send";
import type { Caller } from "./session";
import { createSupabaseOutreachStore } from "./store";

export type ReauthProvider = "google" | "hubspot";

export class WebReauthRequired extends Error {
	constructor(readonly provider: ReauthProvider) {
		super(`hace falta reautorizar ${provider}`);
		this.name = "WebReauthRequired";
	}
}

/**
 * El binding no está habilitado (tenant_connections) o el conector no está
 * instalado del lado de Connect. Ninguno de los dos casos se arregla
 * autorizando: falta una fila que solo puede tocar un admin del tenant, o
 * falta instalar el conector — no un grant vencido. A diferencia de
 * WebReauthRequired, quien traduzca esto no debe ofrecer un link de
 * autorización ni llamar a Connect para conseguirlo (hallazgo 3 de la review
 * final: arrancar una autorización sobre un grant que puede estar perfecto
 * lo deja vigente sin servir hasta que la persona consienta — spec §4 lo
 * prohíbe). Mismo caso que agents/outreach/tools/send_email.ts cubre con
 * refuse("sin_gmail", ...) en el chat, sin ofrecer autorizar.
 */
export class WebBindingMissing extends Error {
	constructor(readonly provider: ReauthProvider) {
		super(`${provider} no está habilitado para este tenant`);
		this.name = "WebBindingMissing";
	}
}

/**
 * Mismo subject que agents/outreach/channels/eve.ts: el canal de eve arma el
 * principal con issuer: process.env.NEXT_PUBLIC_SUPABASE_URL (ver
 * supabaseAuth() ahí), y tenantScopedConnect (que usa el chat) lo propaga al
 * crear el subject de Connect. Sin este issuer acá, tokenForSubject y
 * startAuthorizationForSubject piden/autorizan un subject distinto del que
 * usa el chat: mismo tenantId:userId, pero si el issuer forma parte de la
 * identidad para Connect son dos sujetos, y un grant creado desde el chat no
 * aparece al pedirlo desde la web (hallazgo 2 de la review final). Se lee en
 * cada llamada, no una vez al importar el módulo, para poder testear sin
 * reimportar el módulo.
 */
export function connectSubjectIssuer(): string | undefined {
	return process.env.NEXT_PUBLIC_SUPABASE_URL;
}

/**
 * Token de Connect que traduce un grant vencido, revocado o nunca dado en
 * WebReauthRequired, y un conector no instalado en WebBindingMissing, en vez
 * de dejar pasar el error crudo de Connect: acá es el único lugar que sabe
 * qué proveedor pidió el token, así que es el único lugar que puede ponerle
 * el nombre correcto al mensaje o al link. hasEnabledBinding en webSendDeps
 * solo mira si el tenant configuró el binding; esto cubre el caso normal de
 * OAuth, el grant que configuró pero venció.
 */
async function tokenOrReauth(
	provider: ReauthProvider,
	connector: string,
	caller: Caller,
	scopes?: string[],
): Promise<string> {
	try {
		const { token } = await tokenForSubject(
			connector,
			{
				tenantId: caller.tenantId,
				userId: caller.userId,
				issuer: connectSubjectIssuer(),
			},
			scopes,
		);
		return token;
	} catch (error) {
		if (isConnectorNotInstalledError(error))
			throw new WebBindingMissing(provider);
		if (isConnectAuthError(error)) throw new WebReauthRequired(provider);
		throw error;
	}
}

/** CrmAuthContext para la web: lanza donde una tool pausaría. */
function webCrmContext(caller: Caller) {
	return {
		async getToken() {
			// El CRM se pide sin scopes explícitos, igual que crmForSession.
			const token = await tokenOrReauth(
				"hubspot",
				HUBSPOT_CONNECTOR_UID,
				caller,
			);
			return { token };
		},
		requireAuth(): never {
			throw new WebReauthRequired("hubspot");
		},
	};
}

/** Solo lo que rejectQueueItem declara (`Pick<QueueDeps, "store" | "now">`):
 * rechazar una pieza no toca el CRM, así que no hay que pedir el token de
 * HubSpot para eso — pedirlo de más rompería el rechazo más simple de las
 * tres acciones si el grant de HubSpot venció. */
export function webStoreDeps(): Pick<QueueDeps, "store" | "now"> {
	return {
		store: createSupabaseOutreachStore(createAdminClient()),
		now: () => new Date(),
	};
}

export async function webQueueDeps(caller: Caller): Promise<QueueDeps> {
	const brain = await brainForTenant(caller.tenantId);
	const crm = await crmForSession(webCrmContext(caller), caller.tenantId);
	return {
		...webStoreDeps(),
		crm: crm?.adapter ?? null,
		loadCanon: (slug) => loadCanon(brain, slug),
	};
}

export async function webSendDeps(caller: Caller): Promise<SendDeps> {
	if (!(await hasEnabledBinding(caller.tenantId, "mail", "gmail"))) {
		throw new WebBindingMissing("google");
	}
	// GMAIL_SCOPES completo, no solo send: Connect matchea el grant por
	// conjunto exacto (mismo motivo que en send_email.ts).
	const token = await tokenOrReauth("google", GOOGLE_CONNECTOR_UID, caller, [
		...GMAIL_SCOPES,
	]);
	const [brain, crm] = await Promise.all([
		brainForTenant(caller.tenantId),
		crmForSession(webCrmContext(caller), caller.tenantId),
	]);
	return {
		...webStoreDeps(),
		crm: crm?.adapter ?? null,
		crmAfterSend: crm?.raw ?? null,
		loadCanon: (slug) => loadCanon(brain, slug),
		sendMail: (mail) => sendMail(token, mail),
		isMailUnauthorized: (error) => error instanceof GmailUnauthorizedError,
		isMailUnknownOutcome: (error) => error instanceof GmailUnknownOutcomeError,
	};
}
