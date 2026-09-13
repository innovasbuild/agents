// Registro puro de proveedores de conectores (spec 02 §4). Sin imports y solo
// con sintaxis de tipos borrable: scripts/connections-bind.mts lo ejecuta con
// Node directo, sin bundler.

export type Capability = "crm" | "leads" | "enrichment" | "brain" | "mail";

export interface ProviderInfo {
	capability: Capability;
	/** La capacidad admite varios proveedores por tenant. */
	multiple: boolean;
	/** "tool": no produce conexión de eve (Gmail la usa una tool propia). */
	kind: "connection" | "tool";
	authKind: "connect_api_key" | "connect_oauth";
}

export const PROVIDERS = {
	hubspot: {
		capability: "crm",
		multiple: false,
		kind: "connection",
		authKind: "connect_oauth",
	},
	"innovas-brains": {
		capability: "brain",
		multiple: false,
		kind: "connection",
		authKind: "connect_api_key",
	},
	coldiq: {
		capability: "leads",
		multiple: true,
		kind: "connection",
		authKind: "connect_api_key",
	},
	"google-places": {
		capability: "leads",
		multiple: true,
		kind: "connection",
		authKind: "connect_api_key",
	},
	gmail: {
		capability: "mail",
		multiple: false,
		kind: "tool",
		authKind: "connect_oauth",
	},
} as const satisfies Record<string, ProviderInfo>;

export type ProviderKey = keyof typeof PROVIDERS;

export interface Binding {
	id: string;
	tenantId: string;
	capability: Capability;
	provider: string;
	connectorUid: string | null;
	config: Record<string, unknown>;
}

export function isProviderKey(value: string): value is ProviderKey {
	return Object.hasOwn(PROVIDERS, value);
}

export function connectionName(provider: ProviderKey): string {
	const info = PROVIDERS[provider];
	return info.multiple ? `${info.capability}-${provider}` : info.capability;
}
