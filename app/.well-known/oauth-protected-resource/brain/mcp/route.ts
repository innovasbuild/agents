// Metadata RFC 9728 del brain en el dominio de una empresa (spec 21.6 H14): el
// recurso es /brain/mcp, sin slug, y la metadata se deriva de esa ruta. La
// empresa sale del host. En el host raíz esta ruta no existe: ahí el recurso
// lleva slug y su metadata está en brain/[tenant]/mcp.
import { publicSettings } from "@/lib/brain/adapters/mcp-production";
import { protectedResourceMetadata } from "@/lib/brain/core/mcp-server/handler";
import {
	hostContextOrResponse,
	tenantNotFound,
} from "@/lib/tenants/host-store";

const CORS = {
	"access-control-allow-origin": "*",
	"access-control-allow-methods": "GET, HEAD, OPTIONS",
	"access-control-allow-headers": "*",
};

export async function GET(request: Request) {
	const host = await hostContextOrResponse(request.headers);
	if (host instanceof Response) return host;
	if (host.binding.kind !== "tenant") return tenantNotFound();

	return Response.json(
		protectedResourceMetadata(host.binding.slug, {
			...publicSettings(host.publicUrl),
			tenantHost: true,
		}),
		{ headers: { ...CORS, "cache-control": "public, max-age=300" } },
	);
}

export function OPTIONS(): Response {
	return new Response(null, { status: 204, headers: CORS });
}
