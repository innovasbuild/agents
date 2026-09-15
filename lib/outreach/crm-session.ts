// Adapter de CRM del tenant para una tool, con el token del usuario de la sesión.
import { tenantScopedConnect } from "../connectors/auth";
import { hasEnabledBinding } from "../connectors/bindings";
import type { CrmAdapter } from "../connectors/crm/adapter";
import { HubSpotUnauthorizedError } from "../connectors/crm/hubspot";
import { createHubSpotAdapter } from "../connectors/crm/hubspot-adapter";
import { HUBSPOT_CONNECTOR_UID } from "../connectors/platform";

// authKey "hubspot": el mismo que usa crm_setup_outreach_properties.
export const HUBSPOT_AUTH_OPTIONS = {
	authKey: "hubspot",
	displayName: "HubSpot",
} as const;

type ConnectProvider = ReturnType<typeof tenantScopedConnect>;

// Sintaxis de método a propósito: el ctx de eve es más amplio y así es asignable.
export interface CrmAuthContext {
	getToken(
		provider: ConnectProvider,
		options: typeof HUBSPOT_AUTH_OPTIONS,
	): Promise<{ token: string }>;
	requireAuth(
		provider: ConnectProvider,
		options: typeof HUBSPOT_AUTH_OPTIONS,
	): never;
}

export interface CrmSession {
	/** Pide reautorizar ante un 401: usar antes de cualquier efecto externo. */
	adapter: CrmAdapter;
	/** Deja pasar el 401: usar después de enviar, donde no se puede pausar. */
	raw: CrmAdapter;
}

export function withReauth(
	adapter: CrmAdapter,
	onUnauthorized: () => never,
): CrmAdapter {
	const guard =
		<A extends unknown[], R>(fn: (...args: A) => Promise<R>) =>
		async (...args: A): Promise<R> => {
			try {
				return await fn(...args);
			} catch (error) {
				if (error instanceof HubSpotUnauthorizedError) onUnauthorized();
				throw error;
			}
		};
	return {
		findContacts: guard(adapter.findContacts),
		lastAuthorship: guard(adapter.lastAuthorship),
		upsertContact: guard(adapter.upsertContact),
		addNote: guard(adapter.addNote),
		completeOpenTasks: guard(adapter.completeOpenTasks),
		createTask: guard(adapter.createTask),
	};
}

export async function crmForSession(
	ctx: CrmAuthContext,
	tenantId: string,
): Promise<CrmSession | null> {
	if (!(await hasEnabledBinding(tenantId, "crm", "hubspot"))) return null;
	const provider = tenantScopedConnect(HUBSPOT_CONNECTOR_UID, tenantId);
	const { token } = await ctx.getToken(provider, HUBSPOT_AUTH_OPTIONS);
	const raw = createHubSpotAdapter(token);
	return {
		adapter: withReauth(raw, () =>
			ctx.requireAuth(provider, HUBSPOT_AUTH_OPTIONS),
		),
		raw,
	};
}
