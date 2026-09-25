import { handleBrainMcp } from "@/lib/brain/mcp-server/handler";
import { productionDeps } from "@/lib/brain/mcp-server/production";

export async function POST(
	request: Request,
	{ params }: RouteContext<"/brain/[tenant]/mcp">,
) {
	const { tenant } = await params;
	return handleBrainMcp(request, tenant, productionDeps());
}

function methodNotAllowed(): Response {
	return new Response(null, { status: 405, headers: { allow: "POST" } });
}

export const GET = methodNotAllowed;
export const DELETE = methodNotAllowed;
