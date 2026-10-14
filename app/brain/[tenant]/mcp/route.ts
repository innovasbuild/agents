import { productionDeps } from "@/lib/brain/adapters/mcp-production";
import { handleBrainMcp } from "@/lib/brain/core/mcp-server/handler";
import { hostContextOrResponse } from "@/lib/tenants/host-store";

export async function POST(
	request: Request,
	{ params }: RouteContext<"/brain/[tenant]/mcp">,
) {
	const { tenant } = await params;
	// En el dominio de una empresa el proxy reescribe /brain/mcp a esta ruta con
	// el slug de esa empresa (spec 21.6); el handler vuelve a validar el host.
	const host = await hostContextOrResponse(request.headers);
	if (host instanceof Response) return host;
	return handleBrainMcp(request, tenant, productionDeps(host));
}

function methodNotAllowed(): Response {
	return new Response(null, { status: 405, headers: { allow: "POST" } });
}

export const GET = methodNotAllowed;
export const DELETE = methodNotAllowed;
