// Las dependencias de los servicios de outreach, armadas fuera de eve.
// El espejo de agents/outreach/tools/send_email.ts: mismos servicios, misma
// identidad, pero sin ctx. La diferencia que importa es requireAuth: una tool
// pausa el turno y muestra la tarjeta de autorización; una server action no
// puede pausar, así que lanza y la action traduce el error a un link.
import { tokenForSubject } from "@/lib/connectors/auth";
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

/** CrmAuthContext para la web: lanza donde una tool pausaría. */
function webCrmContext(caller: Caller) {
	return {
		async getToken() {
			const { token } = await tokenForSubject(
				// El CRM se pide sin scopes explícitos, igual que crmForSession.
				HUBSPOT_CONNECTOR_UID,
				{ tenantId: caller.tenantId, userId: caller.userId },
			);
			return { token };
		},
		requireAuth(): never {
			throw new WebReauthRequired("hubspot");
		},
	};
}

export async function webQueueDeps(caller: Caller): Promise<QueueDeps> {
	const brain = await brainForTenant(caller.tenantId);
	const crm = await crmForSession(webCrmContext(caller), caller.tenantId);
	return {
		store: createSupabaseOutreachStore(createAdminClient()),
		crm: crm?.adapter ?? null,
		loadCanon: (slug) => loadCanon(brain, slug),
		now: () => new Date(),
	};
}

export async function webSendDeps(caller: Caller): Promise<SendDeps> {
	if (!(await hasEnabledBinding(caller.tenantId, "mail", "gmail"))) {
		throw new WebReauthRequired("google");
	}
	// GMAIL_SCOPES completo, no solo send: Connect matchea el grant por
	// conjunto exacto (mismo motivo que en send_email.ts).
	const { token } = await tokenForSubject(
		GOOGLE_CONNECTOR_UID,
		{ tenantId: caller.tenantId, userId: caller.userId },
		[...GMAIL_SCOPES],
	);
	const [brain, crm] = await Promise.all([
		brainForTenant(caller.tenantId),
		crmForSession(webCrmContext(caller), caller.tenantId),
	]);
	return {
		store: createSupabaseOutreachStore(createAdminClient()),
		crm: crm?.adapter ?? null,
		crmAfterSend: crm?.raw ?? null,
		loadCanon: (slug) => loadCanon(brain, slug),
		sendMail: (mail) => sendMail(token, mail),
		isMailUnauthorized: (error) => error instanceof GmailUnauthorizedError,
		isMailUnknownOutcome: (error) => error instanceof GmailUnknownOutcomeError,
		now: () => new Date(),
	};
}
