// Import relativo: lo importa agents/outreach/agent.ts (ver Global Constraints).
import { createAdminClient } from "../supabase/admin";
import {
	type GatewayOptions,
	gatewayOptions,
} from "../workflows/gateway-options";

export interface PickModelInput {
	agentModel: string | null;
	conversationModel: string | null;
	defaultModel: string;
	allowedModels: string[];
}

/**
 * Precedencia: override del agente en el tenant, después lo que eligió el
 * usuario en el hilo, después el default del tenant. `allowed_models` es el
 * freno: sin esa lista, cualquiera se manda un Opus por turno.
 */
export function pickModel(input: PickModelInput): string {
	const candidates = [input.agentModel, input.conversationModel];

	for (const candidate of candidates) {
		if (candidate && input.allowedModels.includes(candidate)) return candidate;
	}

	return input.defaultModel;
}

export async function resolveModelForTenant(
	tenantId: string,
	agent: string,
	conversationId: string | null,
): Promise<string> {
	const admin = createAdminClient();

	const { data: tenant } = await admin
		.from("tenants")
		.select("default_model, allowed_models")
		.eq("id", tenantId)
		.single();

	const { data: tenantAgent } = await admin
		.from("tenant_agents")
		.select("model")
		.eq("tenant_id", tenantId)
		.eq("agent", agent)
		.maybeSingle();

	const { data: conversation } = conversationId
		? await admin
				.from("conversations")
				.select("model")
				.eq("id", conversationId)
				.maybeSingle()
		: { data: null };

	return pickModel({
		agentModel: tenantAgent?.model ?? null,
		conversationModel: conversation?.model ?? null,
		defaultModel: tenant?.default_model ?? "anthropic/claude-sonnet-5",
		allowedModels: tenant?.allowed_models ?? ["anthropic/claude-sonnet-5"],
	});
}

export type ModelSelection =
	| string
	| { model: string; modelOptions: { providerOptions: GatewayOptions } };

/**
 * Lo que devuelve el modelo dinámico del agente. Con slug suma el tag de la
 * empresa, que es lo que separa el gasto del chat en el AI Gateway (spec 21.5
 * §4.3). eve agrega su `sessionId` a las mismas opciones sin pisar los tags.
 */
export function modelSelection(
	model: string,
	tenantSlug: string,
): ModelSelection {
	if (!tenantSlug) return model;
	return {
		model,
		modelOptions: { providerOptions: gatewayOptions(tenantSlug) },
	};
}
