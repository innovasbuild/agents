import { notFound } from "next/navigation";
import { loadBrainPages, loadEditorContext } from "@/lib/brain/editor/load";
import { PageForm } from "../page-form";

export default async function NewBrainPage({
	params,
}: {
	params: Promise<{ tenant: string }>;
}) {
	const { tenant: tenantSlug } = await params;
	const ctx = await loadEditorContext(tenantSlug);
	if (!ctx || ctx.kind !== "ok" || !ctx.canEdit) notFound();
	const pages = await loadBrainPages(ctx.tenant.id);
	return (
		<div>
			<h1 className="mb-6 text-3xl leading-tight">Nueva página</h1>
			<PageForm
				mode="new"
				tenantSlug={tenantSlug}
				categories={ctx.categories}
				knownTags={[...new Set(pages.flatMap((p) => p.tags))]}
				pages={pages.map(({ slug, title, status }) => ({
					slug,
					title,
					status,
				}))}
				initial={{
					slug: "",
					title: "",
					category: ctx.categories[0],
					status: "borrador",
					tags: [],
					frontmatter: {},
					body: "",
					revision: null,
				}}
			/>
		</div>
	);
}
