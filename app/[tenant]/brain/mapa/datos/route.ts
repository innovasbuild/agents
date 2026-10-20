import {
	loadBrainLinkIndex,
	loadBrainMeta,
	loadEditorContext,
} from "@/lib/brain/adapters/editor";
import { buildGraphPayload, GRAPH_MAX_NODES } from "@/lib/brain/core/graph";

// Datos del grafo del mapa: payload compacto (nodos, aristas, rotos y huérfanas).
// Sale de lo que el proveedor envuelto ya deja ver a esta persona: el handler no
// filtra por su cuenta. Los permisos son por persona, así que nada se cachea.
export async function GET(
	_request: Request,
	{ params }: { params: Promise<{ tenant: string }> },
) {
	const { tenant } = await params;
	const ctx = await loadEditorContext(tenant);
	if (!ctx || ctx.kind !== "ok")
		return new Response("No encontrado", { status: 404 });
	const [pages, index] = await Promise.all([
		loadBrainMeta(ctx),
		loadBrainLinkIndex(ctx),
	]);
	return Response.json(
		buildGraphPayload(pages, index, { maxNodes: GRAPH_MAX_NODES }),
		{ headers: { "cache-control": "private, no-store" } },
	);
}
