import { slugFromParams } from "@/lib/brain/core/editor/slug";
import { loadEditorContext } from "@/lib/brain/editor/load";
import { createServerSupabase } from "@/lib/supabase/server";

// Cuerpo vigente de una página, para el diff del aviso de conflicto. Misma
// regla que la vista: miembro del tenant, proveedor wiki, RLS de lectura.
export async function GET(
	_request: Request,
	{ params }: { params: Promise<{ tenant: string; slug: string[] }> },
) {
	const { tenant, slug: segments } = await params;
	const ctx = await loadEditorContext(tenant);
	const slug = slugFromParams(segments);
	if (!ctx || ctx.kind !== "ok" || !slug)
		return new Response("No encontrado", { status: 404 });
	const { data } = await (await createServerSupabase())
		.from("brain_pages")
		.select("body")
		.eq("tenant_id", ctx.tenant.id)
		.eq("slug", slug)
		.maybeSingle();
	if (!data) return new Response("No encontrado", { status: 404 });
	return new Response(data.body, {
		headers: {
			"content-type": "text/plain; charset=utf-8",
			"cache-control": "no-store",
		},
	});
}
