import { protectedResourceMetadata } from "@/lib/brain/mcp-server/handler";
import { publicSettings } from "@/lib/brain/mcp-server/production";

const CORS = {
	"access-control-allow-origin": "*",
	"access-control-allow-methods": "GET, HEAD, OPTIONS",
	"access-control-allow-headers": "*",
};

export async function GET(
	_request: Request,
	{
		params,
	}: RouteContext<"/.well-known/oauth-protected-resource/brain/[tenant]/mcp">,
) {
	const { tenant } = await params;
	return Response.json(protectedResourceMetadata(tenant, publicSettings()), {
		headers: { ...CORS, "cache-control": "public, max-age=300" },
	});
}

export function OPTIONS(): Response {
	return new Response(null, { status: 204, headers: CORS });
}
