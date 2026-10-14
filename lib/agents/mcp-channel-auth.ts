// Acceso al canal MCP del agente (spec etapa 6 §4.2, D-MCP-1, D-MCP-3,
// D-MCP-5). El tenant sale de ?tenant= en la URL de conexión, nunca de un
// argumento. Los roles se resuelven antes que el tenant: mismo motivo que
// access.ts de la Etapa 11 (F4) — nadie sin acceso distingue qué slugs
// existen por el mensaje de error.
import {
	type AuthFn,
	extractBearerToken,
	ForbiddenError,
	UnauthenticatedError,
} from "eve/channels/auth";
import {
	createOAuthClaimsVerifier,
	loadMemberships,
	loadPlatformOwnerTenantId,
	loadTenantBySlug,
} from "../auth/oauth-principal";
import { tenantSubjectId } from "../connectors/auth";
import type { HostBinding } from "../tenants/host";
import { resolveHostBinding } from "../tenants/host-store";
import { fallbackPublicUrl, originForBinding } from "../tenants/public-url";
import { loadAgentEnabled } from "./agent-enabled";

type SessionAuthContext = Exclude<
	Awaited<ReturnType<AuthFn<Request>>>,
	null | undefined
>;

export interface McpChannelAuthDeps {
	verify: (token: string) => Promise<Record<string, unknown> | null>;
	tenantBySlug: (
		slug: string,
	) => Promise<{ id: string; active: boolean } | null>;
	membershipsOf: (
		userId: string,
	) => Promise<{ tenantId: string; role: string }[]>;
	// Id del tenant dueño de la plataforma, o null si no hay uno configurado.
	// Una fila platform_admin solo cuenta como plataforma si es de ese tenant,
	// igual que en la web y en el endpoint MCP del brain.
	platformOwnerTenantId: () => Promise<string | null>;
	// ¿El agente de este canal está habilitado para ese tenant? Se pregunta
	// recién cuando la persona ya probó que pertenece al tenant.
	agentEnabled: (tenantId: string) => Promise<boolean>;
	// A qué empresa sirve el host del request (spec 21.6). Sin esto, o en el
	// host raíz, el tenant sale solo de ?tenant= como siempre.
	host?: (request: Request) => Promise<HostBinding>;
}

export type McpChannelAuth =
	| { ok: true; sessionAuth: SessionAuthContext }
	| { ok: false; kind: "unauthenticated" | "forbidden"; message: string };

function deny(
	kind: "unauthenticated" | "forbidden",
	message: string,
): McpChannelAuth {
	return { ok: false, kind, message };
}

export async function resolveMcpChannelAuth(
	request: Request,
	deps: McpChannelAuthDeps,
): Promise<McpChannelAuth> {
	const token = extractBearerToken(request.headers.get("authorization"));
	if (!token) return deny("unauthenticated", "El token no es válido o venció.");

	let claims: Record<string, unknown> | null;
	try {
		claims = await deps.verify(token);
	} catch (error) {
		console.warn(
			`canal mcp: el verificador rechazó el token (${error instanceof Error ? error.name : "desconocido"})`,
		);
		return deny("unauthenticated", "El token no es válido o venció.");
	}
	if (!claims || typeof claims.sub !== "string" || claims.sub === "") {
		return deny("unauthenticated", "El token no es válido o venció.");
	}
	const userId = claims.sub;

	let slug = new URL(request.url).searchParams.get("tenant");
	if (deps.host) {
		let binding: HostBinding;
		try {
			binding = await deps.host(request);
		} catch (error) {
			console.error("canal mcp: no pude resolver el host", error);
			return deny(
				"forbidden",
				"No pude verificar tu acceso a ese cliente. Probá de nuevo.",
			);
		}
		// En el dominio de una empresa el tenant es el del host y ?tenant= es
		// opcional; uno distinto se trata como una empresa sin acceso. Un host
		// que no es de nadie no sirve a nadie.
		if (
			binding.kind === "unknown" ||
			(binding.kind === "tenant" && slug && slug !== binding.slug)
		) {
			return deny("forbidden", "No tenés acceso a ese cliente.");
		}
		if (binding.kind === "tenant") slug = binding.slug;
	}
	if (!slug) {
		return deny(
			"forbidden",
			"Falta el tenant en la URL de conexión: agregá ?tenant=<slug>.",
		);
	}

	let roles: { tenantId: string; role: string }[];
	let tenant: { id: string; active: boolean } | null;
	let ownerTenantId: string | null = null;
	try {
		roles = await deps.membershipsOf(userId);
		// Una fila platform_admin fuera del tenant dueño no es rol de plataforma
		// (spec consola §3): vale como tenant_admin de ese tenant. El tenant
		// dueño solo se consulta a quien tiene alguna fila así.
		if (roles.some((row) => row.role === "platform_admin")) {
			ownerTenantId = await deps.platformOwnerTenantId();
		}
		tenant = await deps.tenantBySlug(slug);
	} catch (error) {
		console.error("canal mcp: no pude resolver el acceso", error);
		return deny(
			"forbidden",
			"No pude verificar tu acceso a ese cliente. Probá de nuevo.",
		);
	}
	const platformAdmin =
		ownerTenantId !== null &&
		roles.some(
			(row) => row.role === "platform_admin" && row.tenantId === ownerTenantId,
		);

	if (!tenant || !tenant.active) {
		return deny(
			"forbidden",
			platformAdmin
				? "No existe ese cliente."
				: "No tenés acceso a ese cliente.",
		);
	}

	const own = roles.find((row) => row.tenantId === tenant.id);
	if (!platformAdmin && !own) {
		return deny("forbidden", "No tenés acceso a ese cliente.");
	}

	// Después del guard de membresía a propósito: quien no pertenece al tenant
	// nunca llega acá, así que este mensaje no le dice nada a un extraño.
	let enabled: boolean;
	try {
		enabled = await deps.agentEnabled(tenant.id);
	} catch (error) {
		console.error(
			"canal mcp: no pude leer si el agente está habilitado",
			error,
		);
		return deny(
			"forbidden",
			"No pude verificar tu acceso a ese cliente. Probá de nuevo.",
		);
	}
	if (!enabled) {
		return deny(
			"forbidden",
			"Ese agente no está habilitado para este cliente.",
		);
	}

	// Mismo mapeo que el brain (access.ts): el administrador de plataforma lo es
	// en todos los tenants; una fila platform_admin ajena al dueño es admin del
	// tenant al que pertenece.
	const role = platformAdmin
		? "platform_admin"
		: own?.role === "platform_admin"
			? "tenant_admin"
			: // Inalcanzable sin `own`: el guard de arriba ya respondió forbidden.
				(own?.role ?? "tenant_member");

	return {
		ok: true,
		sessionAuth: {
			authenticator: "oauth",
			// Mismo issuer que el canal del dashboard (lib/agents/eve/web-channel.ts):
			// Connect arma su subject con este campo, así que un issuer distinto
			// sería otra identidad y pediría autorizar Gmail/HubSpot de nuevo.
			issuer: process.env.NEXT_PUBLIC_SUPABASE_URL!,
			principalId: userId,
			principalType: "user",
			// eve arma la clave de dueño de una invocación sin mirar
			// attributes.tenantId: con el userId pelado, la misma persona
			// conectada a dos tenants vería las invocaciones de uno desde el otro.
			subject: tenantSubjectId(tenant.id, userId),
			attributes: {
				email: typeof claims.email === "string" ? claims.email : "",
				tenantId: tenant.id,
				tenantSlug: slug,
				role,
			},
		},
	};
}

let cachedVerify:
	| ((token: string) => Promise<Record<string, unknown> | null>)
	| undefined;

export async function verifyMcpChannelToken(
	request: Request,
	agent: string,
): Promise<SessionAuthContext> {
	if (!cachedVerify) cachedVerify = createOAuthClaimsVerifier();
	const result = await resolveMcpChannelAuth(request, {
		verify: cachedVerify,
		tenantBySlug: loadTenantBySlug,
		membershipsOf: loadMemberships,
		platformOwnerTenantId: loadPlatformOwnerTenantId,
		agentEnabled: (tenantId) => loadAgentEnabled(tenantId, agent),
		host: (req) => resolveHostBinding(req.headers),
	});
	if (result.ok) return result.sessionAuth;
	if (result.kind === "unauthenticated") {
		throw new UnauthenticatedError({
			message: result.message,
			challenges: await mcpChallenge(
				request,
				agent,
				(headers) => resolveHostBinding(headers),
				fallbackPublicUrl(process.env) ?? "",
			),
		});
	}
	throw new ForbiddenError({ message: result.message });
}

/**
 * El desafío 401 del canal, con la metadata del host por el que llegó la
 * persona (spec 21.6). Dentro de eve el request.url es interno (en desarrollo,
 * http://127.0.0.1:<puerto>/eve/v1/mcp) y eve armaría la URL de la metadata con
 * eso; lo público es x-forwarded-host. eve respeta un resource_metadata que ya
 * viene en el desafío. Un host que no resuelve nunca se refleja.
 */
export async function mcpChallenge(
	request: Request,
	agent: string,
	resolve: (headers: Headers) => Promise<HostBinding>,
	fallback: string,
) {
	let binding: HostBinding = { kind: "unknown" };
	try {
		binding = await resolve(request.headers);
	} catch (error) {
		console.error("canal mcp: no pude resolver el host del desafío", error);
	}
	const { origin } = originForBinding(request.headers, binding, fallback);
	const hasToken = /^Bearer\s+\S/i.test(
		request.headers.get("authorization") ?? "",
	);
	return [
		{
			scheme: "Bearer" as const,
			parameters: {
				...(origin
					? {
							resource_metadata: `${origin}/.well-known/oauth-protected-resource/eve/${agent}/v1/mcp`,
						}
					: {}),
				scope: "openid email",
				...(hasToken ? { error: "invalid_token" } : {}),
			},
		},
	];
}
