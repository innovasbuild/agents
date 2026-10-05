import { notFound } from "next/navigation";
import { loadBrainPages, loadEditorContext } from "@/lib/brain/adapters/editor";
import { slugFromParams } from "@/lib/brain/core/editor/slug";
import { PageForm } from "../../page-form";

export default async function EditBrainPage({
	params,
}: {
	params: Promise<{ tenant: string; slug: string[] }>;
}) {
	const { tenant: tenantSlug, slug: segments } = await params;
	const ctx = await loadEditorContext(tenantSlug);
	const slug = slugFromParams(segments);
	if (!ctx || ctx.kind !== "ok" || !ctx.canEdit || !slug) notFound();
	const pages = await loadBrainPages(ctx);
	const page = pages.find((p) => p.slug === slug);
	if (!page) notFound();
	return (
		<div>
			<h1 className="mb-6 text-3xl leading-tight">Editar «{page.title}»</h1>
			<PageForm
				mode="edit"
				tenantSlug={tenantSlug}
				categories={ctx.categories}
				knownTags={[...new Set(pages.flatMap((p) => p.tags))]}
				pages={pages.map(({ slug: s, title, status }) => ({
					slug: s,
					title,
					status,
				}))}
				initial={{ ...page, revision: page.revision }}
			/>
		</div>
	);
}
