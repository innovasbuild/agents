// Metadata RFC 9728 del canal MCP del agente, servida a mano por Next.js.
// mcpChannel/oauthResource la registran adentro del servicio interno de eve,
// pero la reescritura de Vercel para un agente nombrado (ver
// agents/outreach/channels/mcp.ts) solo reenvía el prefijo del protocolo MCP,
// nunca /.well-known/*. Mismo problema que resolvió la Etapa 11 para el
// endpoint del brain (app/.well-known/oauth-protected-resource/brain/[tenant]/mcp/route.ts),
// con la misma forma de respuesta.
import { publicSettings } from "@/lib/brain/adapters/mcp-production";
import { hostContextOrResponse } from "@/lib/tenants/host-store";

const CORS = {
	"access-control-allow-origin": "*",
	"access-control-allow-methods": "GET, HEAD, OPTIONS",
	"access-control-allow-headers": "*",
};

export async function GET(request: Request): Promise<Response> {
	// El recurso tiene que ser la URL a la que se conectó el cliente: en el
	// dominio de una empresa, ese dominio (spec 21.6 §4.5).
	const host = await hostContextOrResponse(request.headers);
	if (host instanceof Response) return host;
	const { publicUrl, issuer } = publicSettings(
		host.tenantHost ? host.publicUrl : undefined,
	);
	const resource = `${publicUrl}/eve/outreach/v1/mcp`;
	return Response.json(
		{
			resource,
			authorization_servers: [issuer],
			bearer_methods_supported: ["header"],
		},
		{ headers: { ...CORS, "cache-control": "public, max-age=300" } },
	);
}

export function OPTIONS(): Response {
	return new Response(null, { status: 204, headers: CORS });
}
