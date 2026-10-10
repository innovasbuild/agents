"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { isCatalogAgent } from "@/lib/agents/catalog";
import { describeConnector } from "@/lib/connectors/auth";
import { inVercel } from "@/lib/connectors/env";
import {
	acceptsManyUids,
	isProviderKey,
	PROVIDERS,
	type ProviderKey,
} from "@/lib/connectors/providers";
import { checkConnectors, verifiedNameFor } from "@/lib/connectors/verify";
import { createAdminClient } from "@/lib/supabase/admin";
import { requirePlatformAdmin } from "@/lib/tenants/platform";

export type ConsoleResult = { ok: true } | { ok: false; message: string };

const SIN_PERMISO: ConsoleResult = { ok: false, message: "No tenés permiso." };
const INVALIDO: ConsoleResult = {
	ok: false,
	message: "No se pudo procesar el pedido.",
};
const GENERICO: ConsoleResult = {
	ok: false,
	message: "No se pudo guardar. Probá de nuevo.",
};

// guid y no uuid: el seed local usa ids que no son v4.
const idSchema = z.guid();
// Identificadores de conectores de Vercel: sin espacios ni comillas. No son secretos.
const UID = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,199}$/;
const BRAIN_ACCESS = ["none", "read", "read_write"] as const;

const DEFAULT_BRAIN_CONFIG = {
	categories: ["empresa", "producto", "comercial", "operacion"],
	requiredFrontmatter: ["title", "category", "status", "updated"],
	search: "fts",
} as const;

/**
 * Un error de una función de consola llega con hint 'consola' y un mensaje
 * escrito para la persona; se muestra tal cual. Cualquier otro se loguea.
 */
function fromDbError(error: {
	code?: string;
	message: string;
	hint?: string | null;
}): ConsoleResult {
	if (error.hint === "consola") return { ok: false, message: error.message };
	console.error("consola:", error.code, error.message);
	return GENERICO;
}

function done(slug: string, result: ConsoleResult): ConsoleResult {
	revalidatePath("/plataforma");
	revalidatePath(`/plataforma/${slug}`);
	return result;
}

async function call(
	slug: string,
	fn:
		| "platform_set_agent"
		| "platform_bind_connection"
		| "platform_set_connection_enabled"
		| "platform_remove_connection"
		| "platform_mark_connection_verified",
	args: Record<string, unknown>,
): Promise<ConsoleResult> {
	// biome-ignore lint/suspicious/noExplicitAny: el nombre de la función y sus argumentos ya están validados arriba
	const { error } = await createAdminClient().rpc(fn as any, args as any);
	return done(slug, error ? fromDbError(error) : { ok: true });
}

export async function setAgent(
	slug: string,
	tenantId: string,
	agent: string,
	enabled: boolean,
	brain: string,
): Promise<ConsoleResult> {
	const admin = await requirePlatformAdmin();
	if (!admin) return SIN_PERMISO;
	if (!idSchema.safeParse(tenantId).success) return INVALIDO;
	if (!isCatalogAgent(agent))
		return { ok: false, message: "Ese agente no existe en el catálogo." };
	if (!(BRAIN_ACCESS as readonly string[]).includes(brain)) return INVALIDO;

	return call(slug, "platform_set_agent", {
		p_actor: admin.userId,
		p_tenant: tenantId,
		p_agent: agent,
		p_enabled: enabled === true,
		p_brain: brain,
	});
}

export async function createBrain(
	slug: string,
	tenantId: string,
): Promise<ConsoleResult> {
	const admin = await requirePlatformAdmin();
	if (!admin) return SIN_PERMISO;
	if (!idSchema.safeParse(tenantId).success) return INVALIDO;

	return call(slug, "platform_bind_connection", {
		p_actor: admin.userId,
		p_tenant: tenantId,
		p_capability: "brain",
		p_provider: "wiki",
		p_connector_uids: [],
		p_config: DEFAULT_BRAIN_CONFIG,
		p_verified_name: null,
	});
}

/** Cuántos identificadores lleva un proveedor: ninguno (OAuth de plataforma), uno, o varios. */
function uidRule(provider: ProviderKey): "none" | "one" | "many" {
	if (PROVIDERS[provider].authKind !== "connect_api_key") return "none";
	return acceptsManyUids(provider) ? "many" : "one";
}

export async function bindConnection(
	slug: string,
	tenantId: string,
	provider: string,
	connectorUids: string[],
): Promise<ConsoleResult> {
	const admin = await requirePlatformAdmin();
	if (!admin) return SIN_PERMISO;
	if (!idSchema.safeParse(tenantId).success) return INVALIDO;
	// wiki y mcp (brain) tienen su propio botón; lo demás tiene que estar en el catálogo.
	if (!isProviderKey(provider) || PROVIDERS[provider].capability === "brain") {
		return { ok: false, message: "Ese proveedor no se asocia desde acá." };
	}

	const uids = [...new Set(connectorUids.map((u) => u.trim()).filter(Boolean))];
	if (uids.some((u) => !UID.test(u))) {
		return {
			ok: false,
			message: "Un identificador tiene caracteres que no van.",
		};
	}
	const rule = uidRule(provider);
	if (rule === "none" && uids.length > 0) {
		return {
			ok: false,
			message:
				"Este proveedor no lleva identificador: cada persona autoriza su cuenta.",
		};
	}
	if (rule === "one" && uids.length !== 1) {
		return {
			ok: false,
			message: "Este proveedor lleva exactamente un identificador.",
		};
	}
	if (rule === "many" && uids.length === 0) {
		return { ok: false, message: "Pegá al menos un identificador." };
	}

	const check = await checkConnectors(uids, {
		inVercel: inVercel(),
		describe: describeConnector,
	});
	if (!check.ok) return { ok: false, message: check.message };

	return call(slug, "platform_bind_connection", {
		p_actor: admin.userId,
		p_tenant: tenantId,
		p_capability: PROVIDERS[provider].capability,
		p_provider: provider,
		p_connector_uids: uids,
		p_config: {},
		p_verified_name: verifiedNameFor(uids, check.names),
	});
}

export async function setConnectionEnabled(
	slug: string,
	connectionId: string,
	enabled: boolean,
): Promise<ConsoleResult> {
	const admin = await requirePlatformAdmin();
	if (!admin) return SIN_PERMISO;
	if (!idSchema.safeParse(connectionId).success) return INVALIDO;

	return call(slug, "platform_set_connection_enabled", {
		p_actor: admin.userId,
		p_connection: connectionId,
		p_enabled: enabled === true,
	});
}

export async function removeConnection(
	slug: string,
	connectionId: string,
): Promise<ConsoleResult> {
	const admin = await requirePlatformAdmin();
	if (!admin) return SIN_PERMISO;
	if (!idSchema.safeParse(connectionId).success) return INVALIDO;

	return call(slug, "platform_remove_connection", {
		p_actor: admin.userId,
		p_connection: connectionId,
	});
}

export async function verifyConnection(
	slug: string,
	connectionId: string,
): Promise<ConsoleResult> {
	const admin = await requirePlatformAdmin();
	if (!admin) return SIN_PERMISO;
	if (!idSchema.safeParse(connectionId).success) return INVALIDO;
	if (!inVercel()) {
		return {
			ok: false,
			message: "La verificación contra Vercel solo corre en un deploy.",
		};
	}

	const { data: row, error } = await createAdminClient()
		.from("tenant_connections")
		.select("id, tenant_id, connector_uid, config, provider")
		.eq("id", connectionId)
		.maybeSingle();
	if (error) {
		console.error("consola:", error.code, error.message);
		return GENERICO;
	}
	if (!row) return INVALIDO;

	const extra = (row.config as { connectorUids?: unknown } | null)
		?.connectorUids;
	const uids = [
		...new Set([
			...(typeof row.connector_uid === "string" ? [row.connector_uid] : []),
			...(Array.isArray(extra)
				? extra.filter((u): u is string => typeof u === "string")
				: []),
		]),
	];
	if (uids.length === 0) {
		return {
			ok: false,
			message: "Este conector no tiene identificador que verificar.",
		};
	}

	const check = await checkConnectors(uids, {
		inVercel: true,
		describe: describeConnector,
	});
	// Sin veredicto (la consulta falló) no se escribe nada: no se pisa una
	// verificación vigente ni se deja un evento falso.
	if (!check.ok && check.kind === "indeterminate") {
		return { ok: false, message: check.message };
	}
	const marked = await call(slug, "platform_mark_connection_verified", {
		p_actor: admin.userId,
		p_connection: connectionId,
		p_verified_name: check.ok ? verifiedNameFor(uids, check.names) : null,
	});
	if (!check.ok) return { ok: false, message: check.message };
	return marked;
}
