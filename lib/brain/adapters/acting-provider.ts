// El agente en el chat actúa en nombre de la persona que inició la sesión (spec
// etapa 17 A2): sus tools ven y escriben lo que esa persona puede. Sin persona
// (schedules, workflows), el agente conserva su propia declaración y ve todo.
//
// Vive en un módulo aparte porque los execute de las tools de eve se
// recompilan y solo pueden cerrar sobre JSON y llamar a imports estables.

import { type AccessRule, isAdminRole } from "../core/access/types.ts";
import { withAccess } from "../core/access/with-access.ts";
import type { BrainBinding } from "../core/resolve.ts";
import type { BrainProvider, BrainRole } from "../core/types.ts";
import { loadAccessRules } from "./access-rules.ts";
import { getBrainProvider } from "./provider.ts";

// Serializable a JSON: es lo que lleva el closure de las tools.
export interface BrainActor {
	userId: string;
	role: BrainRole;
}

interface AuthLike {
	principalId?: string;
	principalType?: string;
	attributes?: Record<string, unknown>;
}

// El rol lo estampa el canal desde memberships. Si falta o no se reconoce, el
// de menor privilegio: nunca se asume administrador.
export function brainActorFrom(
	auth: AuthLike | null | undefined,
): BrainActor | undefined {
	if (!auth || auth.principalType !== "user" || !auth.principalId) {
		return undefined;
	}
	const role = auth.attributes?.role;
	return {
		userId: auth.principalId,
		role:
			role === "tenant_admin" || role === "platform_admin"
				? role
				: "tenant_member",
	};
}

export async function resolveActingProvider(
	binding: BrainBinding,
	actor: BrainActor | undefined,
	deps: {
		provider?: (binding: BrainBinding) => BrainProvider;
		rules?: (tenantId: string) => Promise<AccessRule[]>;
	} = {},
): Promise<BrainProvider> {
	const provider = (deps.provider ?? getBrainProvider)(binding);
	if (!actor) return provider;
	// Solo un miembro común depende de las reglas. Si no se pueden cargar, la
	// excepción sale: se falla cerrado.
	const rules = isAdminRole(actor.role)
		? []
		: await (deps.rules ?? loadAccessRules)(binding.tenantId);
	return withAccess(
		provider,
		{ kind: "user", userId: actor.userId, role: actor.role },
		rules,
	);
}
