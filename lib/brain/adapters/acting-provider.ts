// El agente en el chat actúa en nombre de la persona que inició la sesión (spec
// etapa 17 A2): sus tools ven y escriben lo que esa persona puede. Sin persona
// (schedules, workflows), el agente conserva su propia declaración y ve todo.
//
// Vive en un módulo aparte porque los execute de las tools de eve se
// recompilan y solo pueden cerrar sobre JSON y llamar a imports estables.

import { resolveAccess } from "../core/access/resolve-access.ts";
import {
	type AccessRule,
	isAdminRole,
	type Principal,
} from "../core/access/types.ts";
import { withAccess } from "../core/access/with-access.ts";
import type { BrainBinding } from "../core/resolve.ts";
import {
	type BrainSessionContext,
	type RulesSource,
	seesBrain,
	withRulesAccess,
} from "../core/rules-source.ts";
import type { BrainProvider, BrainRole } from "../core/types.ts";
import { loadAccessRules } from "./access-rules.ts";
import { getBrainProvider } from "./provider.ts";
import { getBrainRules } from "./rules.ts";

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

interface ActingDeps {
	provider?: (binding: BrainBinding) => BrainProvider;
	rules?: (tenantId: string) => Promise<AccessRule[]>;
	rulesSource?: (binding: BrainBinding) => RulesSource;
}

// Solo un miembro común depende de las reglas. Si no se pueden cargar, la
// excepción sale: se falla cerrado.
async function actingAccess(
	binding: BrainBinding,
	actor: BrainActor,
	deps: ActingDeps,
): Promise<{ principal: Principal; rules: AccessRule[] }> {
	const rules = isAdminRole(actor.role)
		? []
		: await (deps.rules ?? loadAccessRules)(binding.tenantId);
	return {
		principal: { kind: "user", userId: actor.userId, role: actor.role },
		rules,
	};
}

export async function resolveActingProvider(
	binding: BrainBinding,
	actor: BrainActor | undefined,
	deps: ActingDeps = {},
): Promise<BrainProvider> {
	const provider = (deps.provider ?? getBrainProvider)(binding);
	if (!actor) return provider;
	const access = await actingAccess(binding, actor, deps);
	return withAccess(provider, access.principal, access.rules);
}

// Las reglas que le llegan a quien actúa (spec etapa 26 §4.2): filtradas por
// lo que ve. Sin persona, el agente las ve todas.
export async function resolveActingRules(
	binding: BrainBinding,
	actor: BrainActor | undefined,
	deps: Pick<ActingDeps, "rules" | "rulesSource"> = {},
): Promise<RulesSource> {
	const source = (deps.rulesSource ?? getBrainRules)(binding);
	if (!actor) return source;
	const access = await actingAccess(binding, actor, deps);
	return withRulesAccess(source, (path) =>
		resolveAccess(access.rules, access.principal, path),
	);
}

// Lo que el arranque del chat le muestra a quien actúa (spec etapa 26 §4.3):
// carpetas que ve, e instrucciones de la raíz solo si ve alguna parte del brain
// (mismo criterio que el MCP). null: la persona no ve nada del brain.
export async function resolveActingSession(
	binding: BrainBinding,
	actor: BrainActor | undefined,
	deps: Pick<ActingDeps, "rules" | "rulesSource"> = {},
): Promise<BrainSessionContext | null> {
	const source = (deps.rulesSource ?? getBrainRules)(binding);
	if (!actor) return source.session();
	const access = await actingAccess(binding, actor, deps);
	const levelOf = (path: string) =>
		resolveAccess(access.rules, access.principal, path);
	if (!seesBrain(access.rules, levelOf)) return null;
	return withRulesAccess(source, levelOf).session();
}

// Proveedor y reglas con una sola carga de las reglas de acceso.
export async function resolveActingBrain(
	binding: BrainBinding,
	actor: BrainActor | undefined,
	deps: ActingDeps = {},
): Promise<{ provider: BrainProvider; rules: RulesSource }> {
	const provider = (deps.provider ?? getBrainProvider)(binding);
	const source = (deps.rulesSource ?? getBrainRules)(binding);
	if (!actor) return { provider, rules: source };
	const access = await actingAccess(binding, actor, deps);
	return {
		provider: withAccess(provider, access.principal, access.rules),
		rules: withRulesAccess(source, (path) =>
			resolveAccess(access.rules, access.principal, path),
		),
	};
}
