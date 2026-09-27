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
	loadTenantBySlug,
} from "../auth/oauth-principal";

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

	const slug = new URL(request.url).searchParams.get("tenant");
	if (!slug) {
		return deny(
			"forbidden",
			"Falta el tenant en la URL de conexión: agregá ?tenant=<slug>.",
		);
	}

	let roles: { tenantId: string; role: string }[];
	let tenant: { id: string; active: boolean } | null;
	try {
		roles = await deps.membershipsOf(userId);
		tenant = await deps.tenantBySlug(slug);
	} catch (error) {
		console.error("canal mcp: no pude resolver el acceso", error);
		return deny(
			"forbidden",
			"No pude verificar tu acceso a ese cliente. Probá de nuevo.",
		);
	}
	const platformAdmin = roles.some((row) => row.role === "platform_admin");

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

	const role = own?.role ?? "platform_admin";

	return {
		ok: true,
		sessionAuth: {
			authenticator: "oauth",
			issuer: `${process.env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1`,
			principalId: userId,
			principalType: "user",
			subject: userId,
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
): Promise<SessionAuthContext> {
	if (!cachedVerify) cachedVerify = createOAuthClaimsVerifier();
	const result = await resolveMcpChannelAuth(request, {
		verify: cachedVerify,
		tenantBySlug: loadTenantBySlug,
		membershipsOf: loadMemberships,
	});
	if (result.ok) return result.sessionAuth;
	if (result.kind === "unauthenticated") {
		throw new UnauthenticatedError({ message: result.message });
	}
	throw new ForbiddenError({ message: result.message });
}
