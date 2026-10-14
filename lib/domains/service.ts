// Alta, verificación y baja de los dominios de una empresa (spec 21.6 §4.8 y
// §4.9). Puro: todo lo que toca el mundo (base, Vercel, Supabase Auth) entra
// por `deps`. Sin imports de Next: lo usa un schedule de eve.

import type { RootHosts } from "../tenants/host";
import { type HostnameCheck, validateTenantHostname } from "./hostname";
import type { AuthRedirects } from "./supabase-auth";
import { syncAuthRedirectUrls } from "./supabase-auth";
import { VercelApiError, type VercelDomains } from "./vercel";

export type DomainStatus = "pending" | "verifying" | "active" | "failed";

export interface DomainRow {
	id: string;
	tenantId: string;
	hostname: string;
	isPrimary: boolean;
	status: DomainStatus;
	lastError: string | null;
	verifiedAt: string | null;
	createdAt: string;
}

export interface DomainStore {
	list(tenantId: string): Promise<DomainRow[]>;
	get(id: string): Promise<DomainRow | null>;
	listVerifying(limit: number): Promise<DomainRow[]>;
	/** Hostnames activos de todas las empresas: lo que la lista de redirects tiene que contener. */
	activeHostnames(): Promise<string[]>;
	insert(input: {
		tenantId: string;
		hostname: string;
		createdBy: string | null;
	}): Promise<
		{ ok: true; row: DomainRow } | { ok: false; reason: "duplicate" }
	>;
	update(
		id: string,
		patch: Partial<{
			status: DomainStatus;
			lastError: string | null;
			verifiedAt: string | null;
			isPrimary: boolean;
		}>,
	): Promise<void>;
	clearPrimary(tenantId: string): Promise<void>;
	remove(id: string): Promise<void>;
}

export interface DomainDeps {
	store: DomainStore;
	vercel: VercelDomains | null;
	redirects: AuthRedirects | null;
	roots: RootHosts;
	production: boolean;
	now?: () => Date;
}

export type DomainResult =
	| { ok: true; message: string }
	| { ok: false; message: string };

const SIN_VERCEL: DomainResult = {
	ok: false,
	message:
		"Falta configurar la API de Vercel (VERCEL_API_TOKEN y VERCEL_PROJECT_ID) en el servidor.",
};
const NO_EXISTE: DomainResult = {
	ok: false,
	message: "No existe ese dominio.",
};

const MENSAJE_TXT =
	"Falta verificar la propiedad del dominio: el cliente tiene que crear el registro TXT.";
const MENSAJE_DNS =
	"Todavía no apunta a la plataforma: falta el registro DNS (CNAME).";

function describeError(error: unknown): string {
	if (error instanceof VercelApiError) return error.message;
	console.error("dominios:", error);
	return "No pude completar el pedido. Probá de nuevo.";
}

/** Los errores que no se arreglan reintentando dejan el dominio en `failed`. */
function isDefinitive(error: unknown): boolean {
	return (
		error instanceof VercelApiError &&
		(error.kind === "in_use" || error.kind === "invalid")
	);
}

async function syncRedirects(
	deps: DomainDeps,
	change: { add: string[]; remove: string[] },
): Promise<void> {
	if (!deps.redirects) {
		throw new Error(
			"Falta configurar la API de Supabase (SUPABASE_ACCESS_TOKEN y SUPABASE_PROJECT_REF).",
		);
	}
	await syncAuthRedirectUrls(deps.redirects, change);
}

/**
 * Lleva un dominio un paso adelante: lo registra en Vercel si hace falta, intenta
 * verificarlo, mira si ya apunta a la plataforma y, recién ahí, lo registra en
 * las Redirect URLs de Supabase y lo activa. Nunca lo activa a medias: sin la
 * entrada en Supabase el link mágico y Google fallan en ese host.
 */
export async function refreshDomain(
	deps: DomainDeps,
	row: DomainRow,
): Promise<DomainResult> {
	if (!deps.vercel) return SIN_VERCEL;
	const { store, vercel } = deps;
	const now = (deps.now ?? (() => new Date()))();

	async function park(status: DomainStatus, lastError: string | null) {
		await store.update(row.id, { status, lastError });
		return { ok: false, message: lastError ?? "" } as DomainResult;
	}

	try {
		let domain = await vercel.get(row.hostname);
		if (!domain) domain = await vercel.add(row.hostname);
		if (!domain.verified) domain = await vercel.verify(row.hostname);
		if (!domain.verified) return await park("verifying", MENSAJE_TXT);

		const config = await vercel.config(row.hostname);
		if (config.configuredBy === null || config.misconfigured) {
			return await park("verifying", MENSAJE_DNS);
		}
	} catch (error) {
		const message = describeError(error);
		return await park(isDefinitive(error) ? "failed" : row.status, message);
	}

	try {
		const active = await store.activeHostnames();
		await syncRedirects(deps, {
			add: [...new Set([...active, row.hostname])],
			remove: [],
		});
	} catch (error) {
		return await park(
			"verifying",
			`No pude registrar el dominio en Supabase Auth: ${
				error instanceof Error ? error.message : "error desconocido"
			}`,
		);
	}

	const siblings = await store.list(row.tenantId);
	const hasPrimary = siblings.some((d) => d.isPrimary && d.id !== row.id);
	await store.update(row.id, {
		status: "active",
		lastError: null,
		verifiedAt: now.toISOString(),
		isPrimary: !hasPrimary,
	});
	return { ok: true, message: "El dominio está activo." };
}

export async function addDomain(
	deps: DomainDeps,
	input: { tenantId: string; rawHostname: string; actorUserId: string | null },
): Promise<DomainResult> {
	if (!deps.vercel) return SIN_VERCEL;
	const check: HostnameCheck = validateTenantHostname(input.rawHostname, {
		roots: deps.roots,
		production: deps.production,
	});
	if (!check.ok) return { ok: false, message: check.message };

	const inserted = await deps.store.insert({
		tenantId: input.tenantId,
		hostname: check.hostname,
		createdBy: input.actorUserId,
	});
	if (!inserted.ok) {
		return { ok: false, message: "Ese dominio ya está cargado." };
	}

	try {
		await deps.vercel.add(check.hostname);
	} catch (error) {
		const message = describeError(error);
		await deps.store.update(inserted.row.id, {
			status: isDefinitive(error) ? "failed" : "pending",
			lastError: message,
		});
		return { ok: false, message };
	}
	await deps.store.update(inserted.row.id, {
		status: "verifying",
		lastError: null,
	});
	// Un primer intento enseguida: si el DNS ya estaba, queda activo en el acto.
	const first = await refreshDomain(deps, {
		...inserted.row,
		status: "verifying",
	});
	return first.ok
		? first
		: {
				ok: true,
				message:
					"Dominio cargado. Pasale al cliente las instrucciones de DNS; cuando estén creadas, verificá.",
			};
}

export async function verifyDomain(
	deps: DomainDeps,
	domainId: string,
): Promise<DomainResult> {
	const row = await deps.store.get(domainId);
	if (!row) return NO_EXISTE;
	if (row.status === "active") {
		return { ok: true, message: "El dominio ya está activo." };
	}
	return refreshDomain(deps, row);
}

export async function setPrimaryDomain(
	deps: DomainDeps,
	domainId: string,
): Promise<DomainResult> {
	const row = await deps.store.get(domainId);
	if (!row) return NO_EXISTE;
	if (row.status !== "active") {
		return {
			ok: false,
			message: "Solo un dominio activo puede ser el principal.",
		};
	}
	if (row.isPrimary) return { ok: true, message: "Ya es el principal." };
	await deps.store.clearPrimary(row.tenantId);
	await deps.store.update(row.id, { isPrimary: true });
	return { ok: true, message: "Es el dominio principal." };
}

export async function removeDomain(
	deps: DomainDeps,
	domainId: string,
): Promise<DomainResult> {
	const row = await deps.store.get(domainId);
	if (!row) return NO_EXISTE;

	let warning = "";
	if (deps.vercel) {
		try {
			await deps.vercel.remove(row.hostname);
		} catch (error) {
			// No se borra la fila si Vercel sigue teniendo el dominio: quedaría un
			// dominio huérfano que nadie ve en la consola.
			return { ok: false, message: describeError(error) };
		}
	} else {
		warning =
			" No se pudo quitar de Vercel porque falta configurar su API: quitalo a mano.";
	}

	await deps.store.remove(row.id);

	try {
		const active = (await deps.store.activeHostnames()).filter(
			(h) => h !== row.hostname,
		);
		await syncRedirects(deps, { add: active, remove: [row.hostname] });
	} catch (error) {
		// Una entrada de más en la lista de redirects no abre nada: se avisa.
		console.error("dominios: no pude sacar el redirect:", error);
		warning +=
			" No pude sacarlo de las Redirect URLs de Supabase: sacalo a mano.";
	}

	if (row.isPrimary) {
		const next = (await deps.store.list(row.tenantId)).find(
			(d) => d.status === "active",
		);
		if (next) await deps.store.update(next.id, { isPrimary: true });
	}
	return { ok: true, message: `Dominio quitado.${warning}` };
}

/** Un barrido sobre los dominios que esperan DNS. Cada uno falla solo. */
export async function sweepVerifyingDomains(
	deps: DomainDeps,
	limit = 25,
): Promise<{ checked: number; activated: number }> {
	if (!deps.vercel) return { checked: 0, activated: 0 };
	const rows = await deps.store.listVerifying(limit);
	let activated = 0;
	for (const row of rows) {
		try {
			const result = await refreshDomain(deps, row);
			if (result.ok) activated += 1;
		} catch (error) {
			console.error("dominios: el barrido falló en un dominio:", error);
		}
	}
	return { checked: rows.length, activated };
}
