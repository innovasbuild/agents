import { loadEditorContext } from "@/lib/brain/adapters/editor";
import { slugFromParams } from "@/lib/brain/core/editor/slug";
import { BrainNotFound } from "@/lib/brain/core/errors";
import type { BrainPage } from "@/lib/brain/core/types";

// Cuerpo vigente de una página, para el diff del aviso de conflicto. Misma
// regla que la vista: miembro del tenant, lectura por el proveedor del brain.
export async function GET(
	_request: Request,
	{ params }: { params: Promise<{ tenant: string; slug: string[] }> },
) {
	const { tenant, slug: segments } = await params;
	const ctx = await loadEditorContext(tenant);
	const slug = slugFromParams(segments);
	if (!ctx || ctx.kind !== "ok" || !slug)
		return new Response("No encontrado", { status: 404 });
	let page: BrainPage;
	try {
		page = await ctx.provider.read(slug);
	} catch (error) {
		if (error instanceof BrainNotFound)
			return new Response("No encontrado", { status: 404 });
		throw error;
	}
	return new Response(page.body, {
		headers: {
			"content-type": "text/plain; charset=utf-8",
			"cache-control": "no-store",
		},
	});
}
