"use server";

import { accountsFor, isAccountKey } from "@/lib/accounts/status";
import { startAuthorizationForSubject } from "@/lib/connectors/auth";
import {
	GOOGLE_CONNECTOR_UID,
	HUBSPOT_CONNECTOR_UID,
} from "@/lib/connectors/platform";
import { GMAIL_SCOPES } from "@/lib/gmail/send";
import { connectSubjectIssuer } from "@/lib/outreach/web-context";
import { webSession } from "@/lib/outreach/web-session";
import { createServerSupabase } from "@/lib/supabase/server";

export type AuthorizationResult =
	| { ok: true; url: string }
	| { ok: false; message: string };

/**
 * El ÚNICO lugar de "Mis cuentas" que arranca una autorización, y solo por un
 * clic: entre este link y el consentimiento, el grant anterior deja de servir
 * (verificado en producción el 2026-09-15). Siempre para el sujeto de la
 * sesión; no hay parámetro para actuar por otra persona. La URL no se registra.
 */
export async function startAccountAuthorization(
	slug: string,
	key: string,
): Promise<AuthorizationResult> {
	if (typeof key !== "string" || !isAccountKey(key)) {
		return { ok: false, message: "Esa cuenta no existe." };
	}
	const session = await webSession(slug);
	if (!session) return { ok: false, message: "Volvé a entrar: no hay sesión." };
	const { caller } = session;

	const supabase = await createServerSupabase();
	const [{ data: connections }, { data: executor }] = await Promise.all([
		supabase
			.from("tenant_connections")
			.select("capability, provider, enabled")
			.eq("tenant_id", caller.tenantId),
		supabase
			.from("executors")
			.select("user_id")
			.eq("tenant_id", caller.tenantId)
			.eq("user_id", caller.userId)
			.maybeSingle(),
	]);
	const mine = accountsFor({
		connections: (connections ?? []) as {
			capability: string;
			provider: string;
			enabled: boolean;
		}[],
		isExecutor: Boolean(executor),
	});
	if (!mine.includes(key)) {
		return { ok: false, message: "Esa cuenta no está disponible para vos." };
	}

	try {
		const { url } = await startAuthorizationForSubject(
			key === "gmail" ? GOOGLE_CONNECTOR_UID : HUBSPOT_CONNECTOR_UID,
			{
				tenantId: caller.tenantId,
				userId: caller.userId,
				issuer: connectSubjectIssuer(),
			},
			key === "gmail" ? [...GMAIL_SCOPES] : undefined,
		);
		return { ok: true, url };
	} catch (error) {
		console.error(
			`mis-cuentas: no pude arrancar la autorización de ${key}:`,
			error instanceof Error ? error.message : "error",
		);
		return {
			ok: false,
			message: "No pude arrancar la autorización. Probá de nuevo.",
		};
	}
}
