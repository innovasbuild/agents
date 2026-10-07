// Lectura de las reglas del tenant (spec etapa 17 §5.3). Recibe el cliente por
// parámetro, como wiki-store.ts. Falla cerrada: si la base no responde, lanza,
// porque tratarlo como "sin reglas" dejaría abiertas las carpetas restringidas.
import type { SupabaseClient } from "@supabase/supabase-js";
import type {
	AccessRule,
	AccessRulesStore,
	AccessRulesWriter,
	RuleLevel,
} from "./types.ts";

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
		// Descartar la fila abriría lo que ella restringe: se falla cerrado.
		throw new Error(
			`No pude interpretar una regla de acceso del brain (path ${String(row.path)})`,
		);
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

export function createSupabaseAccessRulesWriter(
	client: SupabaseClient,
): AccessRulesWriter {
	return {
		async set(tenantId, rule, actorUserId) {
			const { error } = await client.rpc("brain_set_access_rule", {
				p_tenant_id: tenantId,
				p_path: rule.path,
				p_principal: rule.principal,
				p_user_id: rule.userId,
				p_level: rule.level,
				p_actor: actorUserId,
			});
			if (error) {
				throw new Error(
					`No pude guardar el permiso del brain: ${error.message}`,
				);
			}
		},
		async remove(tenantId, key, actorUserId) {
			const { error } = await client.rpc("brain_remove_access_rule", {
				p_tenant_id: tenantId,
				p_path: key.path,
				p_principal: key.principal,
				p_user_id: key.userId,
				p_actor: actorUserId,
			});
			if (error) {
				throw new Error(
					`No pude quitar el permiso del brain: ${error.message}`,
				);
			}
		},
	};
}
