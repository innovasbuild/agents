// Único puente con Vercel Connect (spec 02 §5.2). Ningún otro archivo importa
// @vercel/connect: tests/connectors/import-rule.test.ts lo hace cumplir.
import {
	type ConnectTokenParams,
	getToken,
	getTokenResponse,
	NoValidTokenError,
	startAuthorization,
	UserAuthorizationRequiredError,
} from "@vercel/connect";
import { connect } from "@vercel/connect/eve";

export function tenantSubjectId(tenantId: string, userId: string): string {
	return `${tenantId}:${userId}`;
}

// Un conector api-key se pide como app: Connect devuelve la llave cruda, sin
// prefijo (spec 02 §10.1 S5). El SDK la cachea en proceso hasta expiresAt.
const APP_SUBJECT: ConnectTokenParams = { subject: { type: "app" } };

/**
 * Headers para un conector `api-key`. Se resuelven en cada llamada: la llave
 * nunca queda en el closure del resolver ni en el estado de la sesión.
 */
export function apiKeyHeaders(
	connectorUid: string,
	header: string,
	extra: Record<string, string> = {},
): () => Promise<Record<string, string>> {
	return async () => ({
		...extra,
		[header]: await getToken(connectorUid, APP_SUBJECT),
	});
}

/** Bearer con `expiresAt`: eve renueva antes de que venza en vez de esperar un 401. */
export function apiKeyBearer(connectorUid: string): {
	getToken: () => Promise<{ token: string; expiresAt: number }>;
} {
	return {
		getToken: async () => {
			const { token, expiresAt } = await getTokenResponse(
				connectorUid,
				APP_SUBJECT,
			);
			return { token, expiresAt };
		},
	};
}

/**
 * OAuth por usuario, atado a tenant:usuario. Connect guarda por defecto el
 * grant solo por usuario: sin esto, alguien con memberships en dos tenants
 * usaría la cuenta de un tenant dentro del otro (spec 02 D5).
 */
export function tenantScopedConnect(
	connector: string,
	tenantId: string,
	scopes?: string[],
): ReturnType<typeof connect> {
	if (!tenantId) {
		throw new Error("tenantScopedConnect requiere el tenant de la sesión");
	}
	return connect({
		connector,
		...(scopes ? { tokenParams: { scopes } } : {}),
		createSubject: (principal) => {
			if (principal.type !== "user") {
				throw new Error(
					"las conexiones OAuth por tenant requieren un usuario autenticado",
				);
			}
			return {
				type: "user",
				id: tenantSubjectId(tenantId, principal.id),
				...(principal.issuer ? { issuer: principal.issuer } : {}),
			};
		},
	});
}

/**
 * Token OAuth de un usuario pedido por el proyecto, sin sesión de eve (los
 * schedules de la spec 03 §8.1). Mismo subject que tenantScopedConnect: el
 * grant de un tenant nunca se usa en otro.
 */
export async function tokenForSubject(
	connector: string,
	who: { tenantId: string; userId: string; issuer?: string },
	scopes?: string[],
): Promise<{ token: string; expiresAt: number }> {
	if (!who.tenantId || !who.userId) {
		throw new Error("tokenForSubject requiere tenant y usuario");
	}
	const { token, expiresAt } = await getTokenResponse(connector, {
		subject: {
			type: "user",
			id: tenantSubjectId(who.tenantId, who.userId),
			...(who.issuer ? { issuer: who.issuer } : {}),
		},
		...(scopes ? { scopes } : {}),
	});
	return { token, expiresAt };
}

/**
 * Link de autorización para el mismo subject que tokenForSubject
 * (tenant:usuario). Lo usa una server action del dashboard: a diferencia de
 * una tool de eve, no puede pausar el turno con ctx.requireAuth, así que en
 * vez de un token pide la URL para que el usuario autorice a mano y reintente.
 */
export async function startAuthorizationForSubject(
	connector: string,
	who: { tenantId: string; userId: string; issuer?: string },
	scopes?: string[],
): Promise<{ url: string; expiresAt: number | null }> {
	if (!who.tenantId || !who.userId) {
		throw new Error("startAuthorizationForSubject requiere tenant y usuario");
	}
	const { url, expiresAt } = await startAuthorization(connector, {
		subject: {
			type: "user",
			id: tenantSubjectId(who.tenantId, who.userId),
			...(who.issuer ? { issuer: who.issuer } : {}),
		},
		...(scopes ? { scopes } : {}),
	});
	return { url, expiresAt: expiresAt ?? null };
}

/**
 * ¿Este error de Connect significa "hace falta que el usuario autorice de
 * nuevo" (grant vencido, revocado o nunca dado)? Son las dos clases que
 * getTokenResponse tira con ese sentido — `no_token` y
 * `user_authorization_required` (ver dist/token.js de @vercel/connect) — no
 * cualquier ConnectError: un 500 o un problema de red no es "reautorizá", y
 * tragarlo como tal le mostraría al usuario un link que no arregla nada.
 * Este archivo es el único que puede importar @vercel/connect
 * (tests/connectors/import-rule.test.ts lo hace cumplir), así que quien
 * necesita distinguir el caso usa este predicado en vez de un instanceof
 * directo contra las clases del paquete.
 */
export function isConnectAuthError(error: unknown): boolean {
	return (
		error instanceof NoValidTokenError ||
		error instanceof UserAuthorizationRequiredError
	);
}
