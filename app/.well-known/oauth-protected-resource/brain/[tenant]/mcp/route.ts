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

export async function GET(
	request: Request,
	{
		params,
	}: RouteContext<"/.well-known/oauth-protected-resource/brain/[tenant]/mcp">,
) {
	const { tenant } = await params;
	const host = await hostContextOrResponse(request.headers);
	if (host instanceof Response) return host;
	if (!host.serves(tenant)) return tenantNotFound();

	const settings = publicSettings(host.tenantHost ? host.publicUrl : undefined);
	return Response.json(
		protectedResourceMetadata(tenant, {
			...settings,
			tenantHost: host.tenantHost,
		}),
		{ headers: { ...CORS, "cache-control": "public, max-age=300" } },
	);
}

export function OPTIONS(): Response {
	return new Response(null, { status: 204, headers: CORS });
}
