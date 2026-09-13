// Valores de plataforma verificados en el spike de la Etapa 2
// (docs/superpowers/specs/02-conexiones-innovas.md §10.1). No son secretos:
// son identificadores de conectores de Vercel Connect y nombres de tools.
// Si cambian, se cambian acá y en la spec, en el mismo commit.

export const HUBSPOT_MCP_URL = "https://mcp.hubspot.com/";
// También autoriza la API REST de HubSpot (S3): no hay conector aparte.
export const HUBSPOT_CONNECTOR_UID = "mcp.hubspot.com/hubspot";
export const HUBSPOT_READ_TOOLS = [
	"search_crm_objects",
	"get_crm_objects",
	"get_properties",
	"search_properties",
	"discover_hubspot_schema",
	"search_owners",
	"get_user_details",
] as const satisfies readonly string[];
export const HUBSPOT_SEARCH_CONTACTS_TOOL = "search_crm_objects";

export const GOOGLE_CONNECTOR_UID = "google/google";

export const COLDIQ_BASE_URL = "https://api.coldiq.com";
