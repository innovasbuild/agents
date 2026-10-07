// Lectura de las reglas del tenant (spec etapa 17 §5.3). Recibe el cliente por
// parámetro, como wiki-store.ts. Falla cerrada: si la base no responde, lanza,
// porque tratarlo como "sin reglas" dejaría abiertas las carpetas restringidas.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AccessRule, AccessRulesStore, RuleLevel } from "./types.ts";

const LEVELS: readonly RuleLevel[] = [
	"lector",
	"editor",
	"administrador",
	"ninguno",
];

function toRule(row: Record<string, unknown>): AccessRule[] {
	const principal = row.principal;
	const level = row.level;
	if (
		(principal !== "user" && principal !== "members") ||
		typeof level !== "string" ||
		!(LEVELS as readonly string[]).includes(level)
	) {
		console.warn(
			`brain: regla de acceso descartada por valores desconocidos (path ${String(row.path)})`,
		);
		return [];
	}
	return [
		{
			path: String(row.path),
			principal,
			userId: (row.user_id as string | null) ?? null,
			level: level as RuleLevel,
		},
	];
}

export function createSupabaseAccessRulesStore(
	client: SupabaseClient,
): AccessRulesStore {
	return {
		async load(tenantId) {
			const { data, error } = await client
				.from("brain_access_rules")
				.select("path, principal, user_id, level")
				.eq("tenant_id", tenantId);
			if (error) {
				throw new Error(
					`No pude leer los permisos del brain: ${error.message}`,
				);
			}
			return ((data ?? []) as Array<Record<string, unknown>>).flatMap(toRule);
		},
	};
}
