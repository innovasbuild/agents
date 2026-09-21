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
	authKind: "connect_api_key" | "connect_oauth" | "none";
}

export const PROVIDERS = {
	hubspot: {
		capability: "crm",
		multiple: false,
		kind: "connection",
		authKind: "connect_oauth",
	},
	wiki: {
		capability: "brain",
		multiple: false,
		kind: "tool",
		authKind: "none",
	},
	coldiq: {
		capability: "leads",
		multiple: true,
		kind: "connection",
		authKind: "connect_api_key",
	},
	apollo: {
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

// El nombre de conexión de eve indexa el cliente conectado (MCP/OpenAPI) por
// este string solamente, sin tenant ni instanceKey (eve registry.js
// ConnectionRegistryImpl#getClient). Para authKind "connect_oauth" el nombre
// debe ser único por binding: sin el id, dos tenants con el mismo proveedor
// OAuth comparten el mismo nombre de conexión y, si eve reutiliza una
// instancia de función tibia entre sus sesiones (Fluid Compute), el cliente
// ya autenticado de un tenant se sirve al otro (spike S7, fuga confirmada en
// producción con HubSpot).
export function connectionName(
	binding: Pick<Binding, "provider" | "id">,
): string {
	if (!isProviderKey(binding.provider)) {
		throw new Error(
			`connectionName: proveedor desconocido "${binding.provider}"`,
		);
	}
	const info = PROVIDERS[binding.provider];
	const base = info.multiple
		? `${info.capability}-${binding.provider}`
		: info.capability;
	return info.authKind === "connect_oauth" ? `${base}-${binding.id}` : base;
}
