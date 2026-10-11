// Qué agentes tiene habilitados una empresa, leído una vez por request (spec
// 21.4 §3.3 y §3.4). El menú y el guard de cada pantalla comparten la lectura.
// Es navegación, no autorización: los datos los cierra RLS.
import { notFound } from "next/navigation";
import { cache } from "react";
import type { CatalogAgent } from "../agents/catalog";
import { createServerSupabase } from "../supabase/server";
import { hasChatAgent } from "./home";

/** `null` si no se pudo leer: quien llama no oculta ni cierra nada. */
export const loadEnabledAgents = cache(
	async (tenantId: string): Promise<string[] | null> => {
		try {
			const supabase = await createServerSupabase();
			const { data, error } = await supabase
				.from("tenant_agents")
				.select("agent")
				.eq("tenant_id", tenantId)
				.eq("enabled", true);
			if (error) {
				console.error("agentes habilitados:", error.message);
				return null;
			}
			return (data ?? []).map((row) => row.agent as string);
		} catch (error) {
			console.error("agentes habilitados:", error);
			return null;
		}
	},
);

export const loadBrainEnabled = cache(
	async (tenantId: string): Promise<boolean> => {
		try {
			const supabase = await createServerSupabase();
			const { data, error } = await supabase
				.from("tenant_connections")
				.select("id")
				.eq("tenant_id", tenantId)
				.eq("capability", "brain")
				.eq("enabled", true)
				.limit(1);
			if (error) {
				console.error("brain habilitado:", error.message);
				return false;
			}
			return (data ?? []).length > 0;
		} catch (error) {
			console.error("brain habilitado:", error);
			return false;
		}
	},
);

/** 404 si la empresa no tiene habilitado el agente dueño de esta pantalla. */
export async function requireAgent(
	tenantId: string,
	agent: CatalogAgent,
): Promise<void> {
	const enabled = await loadEnabledAgents(tenantId);
	if (enabled && !enabled.includes(agent)) notFound();
}

/**
 * 404 si la empresa no tiene ningún agente que se use desde el chat. Es la
 * misma regla con la que tenantHome manda a /chat.
 */
export async function requireChatAgent(tenantId: string): Promise<void> {
	const enabled = await loadEnabledAgents(tenantId);
	if (enabled && !hasChatAgent(enabled)) notFound();
}
