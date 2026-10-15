import { notFound, redirect } from "next/navigation";
import { PageWorkspace } from "@/components/brain/editor/page-workspace";
import {
	loadBrainPages,
	loadBrainTree,
	loadEditorContext,
	loadNewPageRulesPanel,
	loadPageRulesPanel,
} from "@/lib/brain/adapters/editor";
import { editableFolders } from "@/lib/brain/core/access/tree";
import { resolveNewPagePrefix } from "@/lib/brain/core/editor/new-page";
import {
	resolveNewRulesPage,
	typedFolder,
} from "@/lib/brain/core/editor/reserved";
import { pageHref } from "@/lib/brain/core/editor/slug";
import { categoryForPath } from "@/lib/brain/core/folders";
import { BRAIN_CATEGORY, RULES_LEAF } from "@/lib/brain/core/types";

export default async function NewBrainPage({
	params,
	searchParams,
}: {
	params: Promise<{ tenant: string }>;
	searchParams: Promise<{ en?: string; reglas?: string }>;
}) {
	const { tenant: tenantSlug } = await params;
	const { en, reglas } = await searchParams;
	const ctx = await loadEditorContext(tenantSlug);
	if (!ctx || ctx.kind !== "ok") notFound();
	// Se puede crear donde se es editor de alguna carpeta, no solo de la raíz. El
	// permiso real lo decide withAccess al guardar.
	const folders = editableFolders(await loadBrainTree(ctx));
	if (folders.length === 0) notFound();
	const pages = await loadBrainPages(ctx);
	const shared = {
		tenantSlug,
		categories: ctx.categories,
		knownTags: [...new Set(pages.flatMap((p) => p.tags))],
		pages: pages.map(({ slug, title, status }) => ({ slug, title, status })),
	};

	// Instrucciones del brain o reglas de una carpeta (spec etapa 26 §4.1): las
	// crea quien administra la carpeta. Si ya existe en cualquier estado, se
	// abre. Nace en borrador: no aplica hasta que se active.
	if (reglas === "1") {
		const target = resolveNewRulesPage(en, ctx.access);
		if (!target) notFound();
		if (pages.some((p) => p.slug === target.slug))
			redirect(pageHref(tenantSlug, target.slug));
		const rules = await loadPageRulesPanel(ctx, target.slug);
		return (
			<div>
				<h1 className="mb-6 text-3xl leading-tight">{target.title}</h1>
				<PageWorkspace
					mode="new"
					{...shared}
					rules={rules}
					slugLocked
					initial={{
						slug: target.slug,
						title: target.title,
						// La que va a guardar el proveedor: brain en la raíz, la del
						// primer segmento en una carpeta.
						category:
							target.slug === RULES_LEAF
								? BRAIN_CATEGORY
								: categoryForPath(target.slug),
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

	const prefix = resolveNewPagePrefix(en, folders);
	const rules = await loadNewPageRulesPanel(ctx, typedFolder(prefix) ?? "");
	return (
		<div>
			<h1 className="mb-2 text-3xl leading-tight">Nueva página</h1>
			{!folders.includes("") && (
				<p className="mb-6 text-muted-foreground text-sm">
					Podés crear páginas en: {folders.join(", ")}.
				</p>
			)}
			<PageWorkspace
				mode="new"
				{...shared}
				rules={rules}
				initial={{
					slug: prefix,
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
