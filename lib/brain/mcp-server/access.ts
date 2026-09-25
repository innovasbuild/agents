// Quién entra al brain de qué tenant por MCP (spec etapa 11 §5.2, D3, D4, D7).
// El tenant sale de la URL y el usuario del token; nada viene de los argumentos.
import { extractBearerToken } from "eve/channels/auth";
import type { BrainBinding } from "../resolve.ts";

export type ClaimsVerifier = (
	token: string,
) => Promise<Record<string, unknown> | null>;

export interface AccessStore {
	tenantBySlug(slug: string): Promise<{ id: string; active: boolean } | null>;
	rolesOf(userId: string): Promise<{ tenantId: string; role: string }[]>;
	brainBinding(tenantId: string): Promise<BrainBinding | null>;
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
			access: "read" | "read_write";
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
	const token = extractBearerToken(input.authorization);
	if (!token) return deny(401, "unauthorized", "Falta el token de acceso.");

	const claims = await deps.verify(token);
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

	const tenant = await deps.store.tenantBySlug(input.slug);
	if (!tenant || !tenant.active)
		return deny(404, "tenant_not_found", "No existe ese cliente.");

	const roles = await deps.store.rolesOf(userId);
	const platformAdmin = roles.some((row) => row.role === "platform_admin");
	const own = roles.find((row) => row.tenantId === tenant.id);
	if (!platformAdmin && !own)
		return deny(403, "forbidden", "No tenés acceso a este cliente.");

	const access =
		platformAdmin || own?.role === "tenant_admin" ? "read_write" : "read";

	const binding = await deps.store.brainBinding(tenant.id);
	if (!binding)
		return deny(
			404,
			"brain_not_configured",
			"Este cliente no tiene brain configurado.",
		);

	return { ok: true, tenantId: tenant.id, userId, access, binding };
}
