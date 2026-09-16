// Chequeos comunes de toda tool que actúa en nombre de un ejecutor.
import type { CrmAdapter } from "../../connectors/crm/adapter";
import { type Refusal, refuse } from "../result";
import type { Caller } from "../session";
import type { ExecutorRow, OutreachStore, TenantOutreach } from "../store";

export async function resolveExecutor(
	store: OutreachStore,
	caller: Caller,
	crm: CrmAdapter | null,
): Promise<Refusal | { executor: ExecutorRow; tenant: TenantOutreach }> {
	const tenant = await store.loadTenantOutreach(caller.tenantId);
	if (!tenant)
		return refuse(
			"outreach_no_habilitado",
			"este tenant no tiene el agente de outreach habilitado",
		);
	const executor = await store.loadExecutor(caller.tenantId, caller.userId);
	if (!executor?.slug) {
		return refuse(
			"no_ejecutor",
			"no sos ejecutor de outreach en este tenant: podés consultar, pero no cargar, encolar ni enviar",
		);
	}
	if (crm && !executor.crmOwnerId) {
		return refuse(
			"ejecutor_sin_crm_owner",
			"tu usuario no tiene owner de CRM cargado (executors.crm_owner_id): sin eso tus propias notas te bloquearían los follow-ups. Pedile a un admin que lo cargue con executors:set",
		);
	}
	return { executor, tenant };
}

/** Mensaje citable si hook, vector o idioma no están en las listas del tenant; null si están. */
export function attributionError(
	tenant: TenantOutreach,
	attribution: { hook: string; vector: string; idioma: string },
): string | null {
	const { hook, vector, idioma } = attribution;
	if (
		tenant.values.hook.includes(hook) &&
		tenant.values.vector.includes(vector) &&
		tenant.values.idioma.includes(idioma)
	) {
		return null;
	}
	return `hook, vector o idioma fuera de las listas del cliente (${hook}, ${vector}, ${idioma})`;
}
