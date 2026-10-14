// Resolución de host con la base y el entorno de producción (spec 21.6 §4.2).
// Sin imports de Next: lo usa el canal MCP de eve, que no puede arrastrarlos.
import { createAdminClient } from "../supabase/admin";
import {
	assertHostServesTenant,
	createHostResolver,
	type HostBinding,
	isRootHost,
	requestHost,
	rootHostsFromEnv,
} from "./host";
import { fallbackPublicUrl, originForBinding } from "./public-url";

export async function lookupTenantSlugByHost(
	host: string,
): Promise<string | null> {
	const { data, error } = await createAdminClient().rpc(
		"resolve_tenant_by_host",
		{ p_host: host },
	);
	if (error) throw new Error(`No pude resolver el host: ${error.message}`);
	return typeof data === "string" ? data : null;
}

let resolver: ReturnType<typeof createHostResolver> | undefined;

function hostResolver() {
	resolver ??= createHostResolver({
		isRoot: (host) => isRootHost(host, rootHostsFromEnv(process.env)),
		lookup: lookupTenantSlugByHost,
	});
	return resolver;
}

/** A quién sirve el host del request. Tira si la base no responde. */
export function resolveHostBinding(headers: Headers): Promise<HostBinding> {
	return hostResolver()(requestHost(headers));
}

export interface RequestHostContext {
	binding: HostBinding;
	/** Origen para armar URLs; vacío si no hay ninguno configurado. */
	publicUrl: string;
	/** Llegó por el dominio de una empresa: las URLs van sin slug. */
	tenantHost: boolean;
	/** ¿Este host puede servir a esta empresa? */
	serves: (slug: string) => boolean;
}

export async function requestHostContext(
	headers: Headers,
): Promise<RequestHostContext> {
	const binding = await resolveHostBinding(headers);
	const { origin, tenantHost } = originForBinding(
		headers,
		binding,
		fallbackPublicUrl(process.env) ?? "",
	);
	return {
		binding,
		publicUrl: origin,
		tenantHost,
		serves: (slug) => assertHostServesTenant(binding, slug),
	};
}

/**
 * Para los route handlers: el contexto del host o, si la base no responde, un
 * 503 ya armado. Un error de lectura no es "no existe": no se cachea ni se
 * convierte en 404.
 */
export async function hostContextOrResponse(
	headers: Headers,
): Promise<RequestHostContext | Response> {
	try {
		return await requestHostContext(headers);
	} catch (error) {
		console.error("host: no pude resolver el dominio", error);
		return Response.json(
			{
				ok: false,
				code: "host_unavailable",
				error: "No pude resolver el dominio. Probá de nuevo.",
			},
			{ status: 503 },
		);
	}
}

/** El 404 de siempre: no se distingue de una empresa que no existe. */
export function tenantNotFound(): Response {
	return Response.json(
		{ ok: false, code: "tenant_not_found", error: "No existe ese cliente." },
		{ status: 404 },
	);
}
