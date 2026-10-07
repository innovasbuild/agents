import { notFound } from "next/navigation";
import {
	loadBrainPages,
	loadBrainTree,
	loadEditorContext,
} from "@/lib/brain/adapters/editor";
import { editableFolders } from "@/lib/brain/core/access/tree";
import { resolveNewPagePrefix } from "@/lib/brain/core/editor/new-page";
import { PageForm } from "../page-form";

export default async function NewBrainPage({
	params,
	searchParams,
}: {
	params: Promise<{ tenant: string }>;
	searchParams: Promise<{ en?: string }>;
}) {
	const { tenant: tenantSlug } = await params;
	const { en } = await searchParams;
	const ctx = await loadEditorContext(tenantSlug);
	if (!ctx || ctx.kind !== "ok") notFound();
	// Se puede crear donde se es editor de alguna carpeta, no solo de la raíz. El
	// permiso real lo decide withAccess al guardar.
	const folders = editableFolders(await loadBrainTree(ctx));
	if (folders.length === 0) notFound();
	const pages = await loadBrainPages(ctx);
	return (
		<div>
			<h1 className="mb-2 text-3xl leading-tight">Nueva página</h1>
			{!folders.includes("") && (
				<p className="mb-6 text-muted-foreground text-sm">
					Podés crear páginas en: {folders.join(", ")}.
				</p>
			)}
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
					slug: resolveNewPagePrefix(en, folders),
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
