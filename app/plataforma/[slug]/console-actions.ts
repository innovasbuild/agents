"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { AGENT_CATALOG, isCatalogAgent } from "@/lib/agents/catalog";
import { describeConnector } from "@/lib/connectors/auth";
import { inVercel } from "@/lib/connectors/env";
import {
	acceptsManyUids,
	isProviderKey,
	PROVIDERS,
	type ProviderKey,
} from "@/lib/connectors/providers";
import { checkConnectors, verifiedNameFor } from "@/lib/connectors/verify";
import { seedCanonPagesForTenant } from "@/lib/outreach/canon-seed";
import { DEFAULT_CANON_PAGES } from "@/lib/outreach/canon-templates";
import { createAdminClient } from "@/lib/supabase/admin";
import { requirePlatformAdmin } from "@/lib/tenants/platform";
import { agentsNeedCanon } from "@/lib/tenants/readiness";
import { budgetResources } from "@/lib/workflows/settings";

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
function fromDbError(
	error: {
		code?: string;
		message: string;
		hint?: string | null;
	},
	byCode: Record<string, string> = {},
): ConsoleResult {
	if (error.hint === "consola") return { ok: false, message: error.message };
	// Funciones que levantan errores crudos, sin hint: se traducen por código.
	const translated = error.code ? byCode[error.code] : undefined;
	if (translated) return { ok: false, message: translated };
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
		| "platform_mark_connection_verified"
		| "platform_set_budget",
	args: Record<string, unknown>,
	byCode?: Record<string, string>,
): Promise<ConsoleResult> {
	// biome-ignore lint/suspicious/noExplicitAny: el nombre de la función y sus argumentos ya están validados arriba
	const { error } = await createAdminClient().rpc(fn as any, args as any);
	return done(slug, error ? fromDbError(error, byCode) : { ok: true });
}

const SIN_CANON: ConsoleResult = {
	ok: false,
	message:
		"Quedó guardado, pero no pude crear las páginas por defecto. Crealas a mano en comercial/icp y comercial/hooks.",
};

// La siembra no puede crear páginas en una categoría que el brain no tiene:
// ahí el paso que falta es agregarla, no crear las páginas a mano.
const SIN_CATEGORIA_CANON: ConsoleResult = {
	ok: false,
	message:
		"Quedó guardado, pero no pude crear las páginas por defecto: el brain no tiene la categoría comercial. Agregala en Categorías y creá a mano comercial/icp y comercial/hooks.",
};

/** true solo si se sabe que al brain le falta alguna categoría del canon. */
function lacksCanonCategory(config: unknown): boolean {
	const categories = (config as { categories?: unknown } | null)?.categories;
	if (!Array.isArray(categories)) return false;
	return DEFAULT_CANON_PAGES.some(
		(page) => !categories.includes(page.category),
	);
}

/**
 * Si algún agente habilitado de la empresa usa el canon del brain. Si no se
 * puede leer, se asume que sí: es lo que pasaba antes de la 21.4, y una página
 * que ya está no se pisa.
 */
async function tenantUsesCanon(tenantId: string): Promise<boolean> {
	const enabled = await readEnabledAgents(tenantId);
	return enabled === null ? true : agentsNeedCanon(enabled);
}

/** Agentes habilitados de la empresa; `null` si no se pudo leer (ya logueado). */
async function readEnabledAgents(
	tenantId: string,
): Promise<{ agent: string }[] | null> {
	try {
		const { data, error } = await createAdminClient()
			.from("tenant_agents")
			.select("agent")
			.eq("tenant_id", tenantId)
			.eq("enabled", true);
		if (error) {
			console.error("consola: no pude leer los agentes:", error.message);
			return null;
		}
		return data ?? [];
	} catch (error) {
		console.error("consola: no pude leer los agentes:", error);
		return null;
	}
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

	// El catálogo vive en código: la base no sabe qué agente necesita brain.
	// La config se lee en la misma consulta para el aviso de la siembra.
	let brainConfig: unknown = null;
	if (enabled === true && AGENT_CATALOG[agent].requiresBrain) {
		const { data, error } = await createAdminClient()
			.from("tenant_connections")
			.select("id, config")
			.eq("tenant_id", tenantId)
			.eq("capability", "brain")
			.eq("enabled", true)
			.limit(1);
		if (error) {
			console.error("consola: no pude leer el brain:", error.message);
			return GENERICO;
		}
		if (!data || data.length === 0) {
			return {
				ok: false,
				message: "Este agente necesita el brain. Creá el brain primero.",
			};
		}
		brainConfig = data[0].config;
	}

	// El canon se siembra solo cuando el agente pasa de apagado a prendido: un
	// Guardar que solo cambia el acceso al brain no crea plantillas. Si no se
	// puede saber el estado previo, no se siembra y se avisa.
	const needsSeed = enabled === true && AGENT_CATALOG[agent].canon;
	const before = needsSeed ? await readEnabledAgents(tenantId) : null;
	const wasOff = before !== null && !before.some((row) => row.agent === agent);

	const saved = await call(slug, "platform_set_agent", {
		p_actor: admin.userId,
		p_tenant: tenantId,
		p_agent: agent,
		p_enabled: enabled === true,
		p_brain: brain,
	});
	// Las páginas del canon nacen cuando hay un agente que las usa, no con el
	// brain (spec 21.4 §4.1). El brain ya existe: se verificó arriba. Un brain
	// que ya tiene canon no recibe plantillas.
	if (saved.ok && needsSeed && wasOff) {
		let seeded = false;
		try {
			seeded = await seedCanonPagesForTenant(tenantId, admin.userId);
		} catch (error) {
			console.error("consola: no pude sembrar el canon:", error);
		}
		if (!seeded) {
			return lacksCanonCategory(brainConfig) ? SIN_CATEGORIA_CANON : SIN_CANON;
		}
	}
	if (saved.ok && needsSeed && before === null) return SIN_CANON;
	return saved;
}

export async function createBrain(
	slug: string,
	tenantId: string,
): Promise<ConsoleResult> {
	const admin = await requirePlatformAdmin();
	if (!admin) return SIN_PERMISO;
	if (!idSchema.safeParse(tenantId).success) return INVALIDO;

	const created = await call(slug, "platform_bind_connection", {
		p_actor: admin.userId,
		p_tenant: tenantId,
		p_capability: "brain",
		p_provider: "wiki",
		p_connector_uids: [],
		p_config: DEFAULT_BRAIN_CONFIG,
		p_verified_name: null,
	});
	if (!created.ok) return created;
	// Las carpetas de primer nivel son las categorías (spec etapa 26 D1).
	const { error: foldersError } = await createAdminClient().rpc(
		"brain_folders_from_config",
		{ p_tenant: tenantId },
	);
	if (foldersError) {
		console.error(
			"consola: no pude crear las carpetas del brain",
			foldersError,
		);
		return {
			ok: false,
			message:
				"El brain se creó, pero no sus carpetas. Crealas desde el brain.",
		};
	}
	// Sin un agente que use el canon, el brain nace vacío (spec 21.4 §4.1).
	if (!(await tenantUsesCanon(tenantId))) return created;
	// Carpeta y archivo por defecto para el ICP y los hooks (spec 21.3 §3.6).
	const seeded = await seedCanonPagesForTenant(tenantId, admin.userId);
	return seeded
		? created
		: {
				ok: false,
				message:
					"El brain quedó creado, pero no pude crear las páginas por defecto. Crealas a mano en comercial/icp y comercial/hooks.",
			};
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

// Entero o decimal con punto, hasta 6 decimales (la precisión de la columna).
const LIMIT = /^\d{1,6}(\.\d{1,6})?$/;

// platform_set_budget levanta errores crudos, sin hint, cuando falta el actor
// (P0001) o la empresa no existe (23503); 23514 es un valor fuera de rango.
const BUDGET_ERRORS = {
	P0001: "No se pudo identificar quién hace el cambio.",
	"23503": "Esa empresa no existe.",
	"23514": "El valor no es válido.",
};

export async function setBudget(
	slug: string,
	tenantId: string,
	resource: string,
	dailyLimit: string,
): Promise<ConsoleResult> {
	const admin = await requirePlatformAdmin();
	if (!admin) return SIN_PERMISO;
	if (!idSchema.safeParse(tenantId).success) return INVALIDO;
	// El registry vive en código: la base no sabe qué recursos existen.
	if (typeof resource !== "string" || !budgetResources().includes(resource)) {
		return { ok: false, message: "Ese recurso no existe." };
	}
	const raw = typeof dailyLimit === "string" ? dailyLimit.trim() : "";
	const limit = LIMIT.test(raw) ? Number(raw) : Number.NaN;
	if (!Number.isFinite(limit) || limit > 100_000) {
		return {
			ok: false,
			message:
				"El límite diario es un número entre 0 y 100000, con punto decimal.",
		};
	}

	return call(
		slug,
		"platform_set_budget",
		{
			p_actor: admin.userId,
			p_tenant: tenantId,
			p_resource: resource,
			p_daily_limit: limit,
		},
		BUDGET_ERRORS,
	);
}
