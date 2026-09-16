// app/[tenant]/cola/actions.ts
"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { startAuthorizationForSubject } from "@/lib/connectors/auth";
import {
	GOOGLE_CONNECTOR_UID,
	HUBSPOT_CONNECTOR_UID,
} from "@/lib/connectors/platform";
import { GMAIL_SCOPES, GmailUnauthorizedError } from "@/lib/gmail/send";
import {
	rejectQueueItem,
	updateQueueItem,
} from "@/lib/outreach/services/queue";
import { sendQueuedEmail } from "@/lib/outreach/services/send";
import {
	connectSubjectIssuer,
	WebBindingMissing,
	WebReauthRequired,
	webQueueDeps,
	webSendDeps,
	webStoreDeps,
} from "@/lib/outreach/web-context";
import { webSession } from "@/lib/outreach/web-session";

export type ColaResult =
	| { ok: true }
	| {
			ok: false;
			message: string;
			authUrl?: string;
			provider?: "google" | "hubspot";
	  };

// Una server action la puede invocar cualquier cliente autenticado con los
// argumentos que quiera: se validan en el borde, igual que el inputSchema de
// las tools.
const slugSchema = z.string().regex(/^[a-z0-9-]{1,63}$/);
const idSchema = z.uuid();
const toEmailSchema = z.email();
const subjectSchema = z.string().min(1).max(200);
const bodySchema = z.string().min(1).max(5000);
const reasonSchema = z.string().trim().min(1).max(500);

const INVALIDO: ColaResult = {
	ok: false,
	message: "No se pudo procesar el pedido.",
};
const SIN_SESION: ColaResult = {
	ok: false,
	message: "Volvé a entrar: no hay sesión.",
};

/** Traduce la falta de grant en un link, que es lo que en el chat sería una pausa. */
async function reauthResult(
	error: WebReauthRequired,
	caller: { tenantId: string; userId: string },
): Promise<ColaResult> {
	const google = error.provider === "google";
	const { url } = await startAuthorizationForSubject(
		google ? GOOGLE_CONNECTOR_UID : HUBSPOT_CONNECTOR_UID,
		// Mismo subject que tokenOrReauth (lib/outreach/web-context.ts): sin el
		// issuer, esto autoriza un sujeto distinto del que pidió el token
		// (hallazgo 2 de la review final).
		{ ...caller, issuer: connectSubjectIssuer() },
		google ? [...GMAIL_SCOPES] : undefined,
	);
	return {
		ok: false,
		message: google
			? "Autorizá Google para poder enviar."
			: "Autorizá HubSpot para poder registrar el contacto.",
		authUrl: url,
		provider: error.provider,
	};
}

/**
 * Traduce la falta de binding en un mensaje honesto, sin link: autorizar no
 * arregla una fila de tenant_connections que solo puede tocar un admin, ni
 * un conector que no está instalado. A diferencia de reauthResult, esto no
 * llama a Connect (hallazgo 3 de la review final: pedir la URL de
 * autorización acá arrancaría una autorización sobre un grant que puede
 * estar perfecto, dejándolo vigente sin servir hasta que alguien la
 * consienta sin necesidad).
 */
function bindingMissingResult(error: WebBindingMissing): ColaResult {
	const google = error.provider === "google";
	return {
		ok: false,
		message: google
			? "Este cliente no tiene Gmail configurado: pedile a un admin del tenant que lo habilite."
			: "Este cliente no tiene HubSpot configurado: pedile a un admin del tenant que lo habilite.",
	};
}

export async function approveAndSend(
	slug: string,
	queueItemId: string,
	toEmail: string,
	subject: string,
	body: string,
): Promise<ColaResult> {
	if (!slugSchema.safeParse(slug).success) return INVALIDO;
	if (!idSchema.safeParse(queueItemId).success) return INVALIDO;
	if (!toEmailSchema.safeParse(toEmail).success) return INVALIDO;
	if (!subjectSchema.safeParse(subject).success) return INVALIDO;
	if (!bodySchema.safeParse(body).success) return INVALIDO;

	const session = await webSession(slug);
	if (!session) return SIN_SESION;
	const { caller } = session;

	try {
		const deps = await webSendDeps(caller);
		const item = await deps.store.getQueueItem(caller.tenantId, queueItemId);
		if (!item)
			return { ok: false, message: "No encuentro esa pieza en la cola." };

		const result = await sendQueuedEmail(
			{
				caller,
				// El prefijo web: distingue en events un envío del dashboard de uno
				// del chat, sin columna nueva.
				sessionId: `web:${randomUUID()}`,
				callId: queueItemId,
				queueItemId,
				// Lo que la persona tiene en pantalla (los argumentos, no lo que
				// acabamos de leer de item más arriba): si se manda item.subject/
				// item.body/item.toEmail, la guarda pieza_cambiada de send.ts
				// compara la base contra sí misma y nunca puede fallar (hallazgo 1
				// de la review final). Es seguro — sendQueuedEmail manda siempre
				// los valores de la base al enviar (send.ts:268-274); lo que llega
				// del cliente se usa ahí solo para comparar.
				to: toEmail,
				subject,
				body,
			},
			deps,
		);
		if (!result.ok) return { ok: false, message: result.message };
		revalidatePath(`/${slug}/cola`);
		return { ok: true };
	} catch (error) {
		if (error instanceof WebBindingMissing) return bindingMissingResult(error);
		if (error instanceof WebReauthRequired) return reauthResult(error, caller);
		// sendQueuedEmail relanza esto cuando Gmail (no Connect) rechaza el
		// token con un 401: el tool del chat la captura con ctx.requireAuth;
		// acá es lo mismo que un grant vencido, así que se traduce igual.
		if (error instanceof GmailUnauthorizedError)
			return reauthResult(new WebReauthRequired("google"), caller);
		throw error;
	}
}

export async function editItem(
	slug: string,
	queueItemId: string,
	subject: string,
	body: string,
): Promise<ColaResult> {
	if (!slugSchema.safeParse(slug).success) return INVALIDO;
	if (!idSchema.safeParse(queueItemId).success) return INVALIDO;
	if (!subjectSchema.safeParse(subject).success) return INVALIDO;
	if (!bodySchema.safeParse(body).success) return INVALIDO;

	const session = await webSession(slug);
	if (!session) return SIN_SESION;

	try {
		const result = await updateQueueItem(
			{ caller: session.caller, queueItemId, subject, body },
			await webQueueDeps(session.caller),
		);
		if (!result.ok) return { ok: false, message: result.message };
		revalidatePath(`/${slug}/cola`);
		return { ok: true };
	} catch (error) {
		if (error instanceof WebBindingMissing) return bindingMissingResult(error);
		if (error instanceof WebReauthRequired)
			return reauthResult(error, session.caller);
		throw error;
	}
}

export async function rejectItem(
	slug: string,
	queueItemId: string,
	reason: string,
): Promise<ColaResult> {
	if (!slugSchema.safeParse(slug).success) return INVALIDO;
	if (!idSchema.safeParse(queueItemId).success) return INVALIDO;
	const parsedReason = reasonSchema.safeParse(reason);
	if (!parsedReason.success)
		return { ok: false, message: "Escribí por qué la descartás." };

	const session = await webSession(slug);
	if (!session) return SIN_SESION;

	// Solo { store, now }: rejectQueueItem no toca el CRM (declara
	// Pick<QueueDeps, "store" | "now">), así que no hay que pedir el token de
	// HubSpot para rechazar una pieza. webQueueDeps lo pide eager y rompería
	// el rechazo si el grant de HubSpot venció, sin ninguna razón para eso.
	const result = await rejectQueueItem(
		{ caller: session.caller, queueItemId, reason: parsedReason.data },
		webStoreDeps(),
	);
	if (!result.ok) return { ok: false, message: result.message };
	revalidatePath(`/${slug}/cola`);
	return { ok: true };
}
