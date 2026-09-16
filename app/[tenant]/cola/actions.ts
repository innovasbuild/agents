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
		caller,
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

export async function approveAndSend(
	slug: string,
	queueItemId: string,
): Promise<ColaResult> {
	if (!slugSchema.safeParse(slug).success) return INVALIDO;
	if (!idSchema.safeParse(queueItemId).success) return INVALIDO;

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
				to: item.toEmail,
				subject: item.subject,
				body: item.body,
			},
			deps,
		);
		if (!result.ok) return { ok: false, message: result.message };
		revalidatePath(`/${slug}/cola`);
		return { ok: true };
	} catch (error) {
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
