// Quién entra al brain de qué tenant por MCP (spec etapa 11 §5.2, D3, D4, D7).
// El tenant sale de la URL y el usuario del token; nada viene de los argumentos.
import type { BrainBinding } from "../resolve.ts";
import type { BrainRole } from "../types.ts";
import { extractBearer } from "./bearer.ts";

export type ClaimsVerifier = (
	token: string,
) => Promise<Record<string, unknown> | null>;

export interface AccessStore {
	tenantBySlug(slug: string): Promise<{ id: string; active: boolean } | null>;
	rolesOf(userId: string): Promise<{ tenantId: string; role: string }[]>;
	brainBinding(tenantId: string): Promise<BrainBinding | null>;
	// Id del tenant dueño de la plataforma, o null si no hay uno configurado.
	// Una fila platform_admin solo cuenta como plataforma si es de ese tenant,
	// igual que en la aplicación (lib/tenants/resolve.ts).
	platformOwnerTenantId(): Promise<string | null>;
	// ¿La empresa permite el método con el que se abrió la sesión de este
	// token? Pregunta a la base con el token de la persona
	// (tenant_allows_login), igual que resolveTenantAccess.
	allowsLogin(token: string, tenantId: string): Promise<boolean>;
}

// Los métodos de login que reconoce public.current_login_method(). Un token
// del servidor OAuth trae en amr solo "oauth_provider/authorization_code":
// no dice con qué método entró la persona, y la base lo leería como método
// desconocido. Ese token pasó por el corte de /oauth/consent al emitirse.
const SESSION_LOGIN_METHODS = new Set([
	"otp",
	"magiclink",
	"invite",
	"email/signup",
	"recovery",
	"oauth",
]);

function namesLoginMethod(claims: Record<string, unknown>): boolean {
	const amr = claims.amr;
	if (!Array.isArray(amr)) return false;
	return amr.some(
		(entry) =>
			typeof entry === "object" &&
			entry !== null &&
			SESSION_LOGIN_METHODS.has(String((entry as { method?: unknown }).method)),
	);
}

type Denied = {
	ok: false;
	status: 401 | 403 | 404;
	code:
		| "unauthorized"
		| "invalid_token"
		| "forbidden"
		| "tenant_not_found"
		| "brain_not_configured";
	message: string;
};

export type McpAccess =
	| {
			ok: true;
			tenantId: string;
			userId: string;
			role: BrainRole;
			binding: BrainBinding;
	  }
	| Denied;

function deny(
	status: Denied["status"],
	code: Denied["code"],
	message: string,
): Denied {
	return { ok: false, status, code, message };
}

export async function resolveMcpAccess(
	input: { authorization: string | null; slug: string },
	deps: { verify: ClaimsVerifier; store: AccessStore },
): Promise<McpAccess> {
	const token = extractBearer(input.authorization);
	if (!token) return deny(401, "unauthorized", "Falta el token de acceso.");

	let claims: Record<string, unknown> | null;
	try {
		claims = await deps.verify(token);
	} catch (error) {
		console.warn(
			`brain mcp: el verificador rechazó el token (${error instanceof Error ? error.name : "desconocido"})`,
		);
		return deny(401, "invalid_token", "El token no es válido o venció.");
	}
	if (!claims || typeof claims.sub !== "string" || claims.sub === "") {
		return deny(401, "invalid_token", "El token no es válido o venció.");
	}
	if (typeof claims.client_id !== "string" || claims.client_id === "") {
		console.warn(
			`brain mcp: token sin client_id; claims presentes: ${Object.keys(claims).join(", ")}`,
		);
		return deny(
			401,
			"invalid_token",
			"El token no fue emitido para una aplicación conectada.",
		);
	}
	const userId = claims.sub;

	// Los roles van antes que el tenant: quien tiene un token no tiene que poder
	// averiguar qué slugs de clientes existen. Solo un platform_admin ve el 404.
	const roles = await deps.store.rolesOf(userId);
	// Una fila platform_admin fuera del tenant dueño no es rol de plataforma
	// (spec consola §3): vale como tenant_admin de ese tenant. El tenant dueño
	// solo se consulta a quien tiene alguna fila así.
	const ownerTenantId = roles.some((row) => row.role === "platform_admin")
		? await deps.store.platformOwnerTenantId()
		: null;
	const platformAdmin =
		ownerTenantId !== null &&
		roles.some(
			(row) => row.role === "platform_admin" && row.tenantId === ownerTenantId,
		);

	const tenant = await deps.store.tenantBySlug(input.slug);
	if (!tenant || !tenant.active) {
		return platformAdmin
			? deny(404, "tenant_not_found", "No existe ese cliente.")
			: deny(403, "forbidden", "No tenés acceso a este cliente.");
	}

	const own = roles.find((row) => row.tenantId === tenant.id);
	if (!platformAdmin && !own)
		return deny(403, "forbidden", "No tenés acceso a este cliente.");

	const role: BrainRole = platformAdmin
		? "platform_admin"
		: own?.role === "tenant_admin" || own?.role === "platform_admin"
			? "tenant_admin"
			: "tenant_member";

	// El método de la sesión tiene que estar permitido (spec etapa 20, L10).
	// Un platform_admin se chequea contra el tenant dueño (L12). Falla cerrado.
	if (namesLoginMethod(claims)) {
		let allowed = false;
		try {
			allowed = await deps.store.allowsLogin(
				token,
				platformAdmin && ownerTenantId ? ownerTenantId : tenant.id,
			);
		} catch (error) {
			console.error(
				`brain mcp: no pude chequear el método de login (${error instanceof Error ? error.name : "desconocido"})`,
			);
		}
		if (!allowed)
			return deny(
				403,
				"forbidden",
				"Tu empresa no permite entrar con ese método.",
			);
	}

	const binding = await deps.store.brainBinding(tenant.id);
	if (!binding)
		return deny(
			404,
			"brain_not_configured",
			"Este cliente no tiene brain configurado.",
		);

	return { ok: true, tenantId: tenant.id, userId, role, binding };
}
