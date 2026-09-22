// Lectura de /contactos: normaliza las filas que devuelve PostgREST y traduce
// los parámetros de la URL a filtros. Los filtros viven en la URL, no en el
// estado del cliente, para que el link del embudo funcione y se pueda compartir.
import { OUTREACH_STAGES, type OutreachStage } from "./stage";

/** Tope del texto de búsqueda: entra en un ILIKE sin volverse un problema. */
export const MAX_QUERY_LENGTH = 100;

export interface ContactRow {
	id: string;
	contactKey: string;
	name: string | null;
	company: string | null;
	email: string | null;
	stage: string;
	touches: number;
	lastTouchAt: string | null;
	nextStepAt: string | null;
	vector: string | null;
	hook: string | null;
	ownerUserId: string | null;
	ownerSlug: string | null;
	accountDomain: string | null;
	icpLane: string | null;
	icpScore: number | null;
}

export interface ContactFilters {
	etapa: OutreachStage | null;
	ejecutor: string | null;
	vector: string | null;
	hook: string | null;
	lane: string | null;
	q: string | null;
}

const first = <T>(value: T | T[] | null | undefined): T | null => {
	if (value === null || value === undefined) return null;
	return Array.isArray(value) ? (value[0] ?? null) : value;
};

const str = (value: unknown): string =>
	typeof value === "string" ? value : "";
const nullableStr = (value: unknown): string | null =>
	typeof value === "string" ? value : null;

export function toContactRows(raw: readonly unknown[]): ContactRow[] {
	return raw.map((entry) => {
		const row = entry as Record<string, unknown>;
		const owner = first(row.executors as { slug?: unknown } | null);
		const account = first(row.accounts as { domain?: unknown } | null);
		const icp = row.icp as {
			lane?: string;
			encaje_empresa?: { score?: number };
		} | null;
		return {
			id: str(row.id),
			contactKey: str(row.contact_key),
			name: nullableStr(row.name),
			company: nullableStr(row.company),
			email: nullableStr(row.email),
			stage: str(row.stage),
			touches: typeof row.touches === "number" ? row.touches : 0,
			lastTouchAt: nullableStr(row.last_touch_at),
			nextStepAt: nullableStr(row.next_step_at),
			vector: nullableStr(row.vector),
			hook: nullableStr(row.hook),
			ownerUserId: nullableStr(row.owner_user_id),
			ownerSlug: nullableStr(owner?.slug),
			accountDomain: nullableStr(account?.domain),
			icpLane: icp?.lane ?? null,
			icpScore:
				typeof icp?.encaje_empresa?.score === "number"
					? icp.encaje_empresa.score
					: null,
		};
	});
}

// Mismo criterio que config_values en la base: minúsculas, dígitos y guiones
// bajos. Un valor que no matchea no se manda a la consulta.
const VALUE_RE = /^[a-z0-9][a-z0-9_]{0,60}$/;
const SLUG_RE = /^[a-z][a-z0-9-]{0,30}$/;

const clean = (value: string | null, re: RegExp): string | null =>
	value !== null && re.test(value) ? value : null;

/**
 * Prepara el texto de búsqueda para un `ilike` dentro de un `or()` de
 * PostgREST. El `or()` no toma parámetros: recibe una string con sintaxis
 * propia, donde la coma separa condiciones, los paréntesis delimitan el grupo
 * y la comilla doble cita valores. Un texto del usuario con esos caracteres no
 * rompe la consulta, hace algo peor: la reescribe. Se sacan, junto con los
 * comodines de LIKE, que si no dejarían buscar cualquier cosa.
 */
export function ilikePattern(value: string): string | null {
	const safe = value.replace(/[,()"%_*\\]/g, "").trim();
	return safe === "" ? null : `%${safe}%`;
}

export function parseContactFilters(params: URLSearchParams): ContactFilters {
	const etapa = params.get("etapa");
	const q = params.get("q")?.trim() ?? "";
	return {
		etapa: (OUTREACH_STAGES as readonly string[]).includes(etapa ?? "")
			? (etapa as OutreachStage)
			: null,
		ejecutor: clean(params.get("ejecutor"), SLUG_RE),
		vector: clean(params.get("vector"), VALUE_RE),
		hook: clean(params.get("hook"), VALUE_RE),
		lane: clean(params.get("lane"), VALUE_RE),
		q: q === "" ? null : q.slice(0, MAX_QUERY_LENGTH),
	};
}
