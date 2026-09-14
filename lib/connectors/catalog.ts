// Catálogo de conectores (spec 02 §4 y §6). Cada builder recibe un binding y
// devuelve la definición de eve, o null si el binding no alcanza para armarla.
import {
	type DynamicConnectionDefinition,
	defineMcpClientConnection,
	defineOpenAPIConnection,
} from "eve/connections";
import { apiKeyBearer, apiKeyHeaders, tenantScopedConnect } from "./auth";
import { COLDIQ_OPERATIONS, coldiqOpenApi } from "./leads/coldiq.openapi";
import { googlePlacesOpenApi } from "./leads/google-places.openapi";
import {
	COLDIQ_BASE_URL,
	HUBSPOT_CONNECTOR_UID,
	HUBSPOT_MCP_URL,
	HUBSPOT_READ_TOOLS,
} from "./platform";
import {
	type Binding,
	connectionName,
	isProviderKey,
	PROVIDERS,
	type ProviderKey,
} from "./providers";

export const GOOGLE_PLACES_FIELD_MASK = [
	"places.id",
	"places.displayName",
	"places.formattedAddress",
	"places.websiteUri",
	"places.nationalPhoneNumber",
	"places.rating",
	"places.types",
].join(",");

type Builder = (binding: Binding) => DynamicConnectionDefinition | null;

function requireConnectorUid(binding: Binding): string | null {
	return binding.connectorUid && binding.connectorUid.trim() !== ""
		? binding.connectorUid
		: null;
}

const BUILDERS: Partial<Record<ProviderKey, Builder>> = {
	coldiq: (binding) => {
		const uid = requireConnectorUid(binding);
		if (!uid) return null;
		return defineOpenAPIConnection({
			spec: coldiqOpenApi,
			baseUrl: COLDIQ_BASE_URL,
			description:
				"ColdIQ: búsqueda de personas y empresas, enriquecimiento, emails y señales de compra, de a un registro. Cada llamada consume créditos del cliente.",
			instanceKey: binding.id,
			auth: apiKeyBearer(uid),
			operations: { allow: [...COLDIQ_OPERATIONS] },
		});
	},

	"google-places": (binding) => {
		const uid = requireConnectorUid(binding);
		if (!uid) return null;
		return defineOpenAPIConnection({
			spec: googlePlacesOpenApi,
			baseUrl: "https://places.googleapis.com",
			description:
				"Google Places: negocios por rubro y zona, con dirección, web, teléfono y rating. Cada búsqueda tiene costo.",
			instanceKey: binding.id,
			headers: apiKeyHeaders(uid, "X-Goog-Api-Key", {
				"X-Goog-FieldMask": GOOGLE_PLACES_FIELD_MASK,
			}),
			operations: { allow: ["searchText"] },
		});
	},

	hubspot: (binding) =>
		defineMcpClientConnection({
			url: HUBSPOT_MCP_URL,
			description:
				"CRM HubSpot con la cuenta del usuario: buscar y leer contactos, empresas, negocios y actividad. Solo lectura.",
			instanceKey: binding.id,
			auth: tenantScopedConnect(HUBSPOT_CONNECTOR_UID, binding.tenantId),
			tools: { allow: [...HUBSPOT_READ_TOOLS] },
		}),
};

export function buildTenantConnections(
	bindings: Binding[],
): Record<string, DynamicConnectionDefinition> {
	const connections: Record<string, DynamicConnectionDefinition> = {};

	for (const binding of bindings) {
		const where = `tenant ${binding.tenantId}, ${binding.capability}/${binding.provider}`;

		if (!isProviderKey(binding.provider)) {
			console.warn(`conector omitido: proveedor desconocido (${where})`);
			continue;
		}
		const info = PROVIDERS[binding.provider];
		if (info.kind !== "connection") {
			console.warn(`conector omitido: no es una conexión de eve (${where})`);
			continue;
		}
		if (info.capability !== binding.capability) {
			console.warn(`conector omitido: capacidad no coincide (${where})`);
			continue;
		}

		const build = BUILDERS[binding.provider];
		if (!build) {
			console.warn(`conector omitido: sin builder todavía (${where})`);
			continue;
		}
		const definition = build(binding);
		if (!definition) {
			console.warn(`conector omitido: binding incompleto (${where})`);
			continue;
		}

		const name = connectionName(binding);
		if (Object.hasOwn(connections, name)) {
			console.warn(`conector omitido: nombre de conexión duplicado (${where})`);
			continue;
		}
		connections[name] = definition;
	}

	return connections;
}
