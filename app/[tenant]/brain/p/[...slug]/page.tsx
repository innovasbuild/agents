import Link from "next/link";
import { notFound } from "next/navigation";
import { PageWorkspace } from "@/components/brain/editor/page-workspace";
import { PageFacts } from "@/components/brain/page-facts";
import { ReadingView } from "@/components/brain/reading-view";
import { Button } from "@/components/ui/button";
import { loadBrainPages, loadEditorContext } from "@/lib/brain/adapters/editor";
import { entryMode } from "@/lib/brain/core/editor/entry-mode";
import {
	historyHref,
	pageHref,
	slugFromParams,
} from "@/lib/brain/core/editor/slug";
import { buildLinkIndex } from "@/lib/brain/core/links";

export default async function BrainPageView({
	params,
}: {
	params: Promise<{ tenant: string; slug: string[] }>;
}) {
	const { tenant: tenantSlug, slug: segments } = await params;
	const ctx = await loadEditorContext(tenantSlug);
	const slug = slugFromParams(segments);
	if (!ctx || ctx.kind !== "ok" || !slug) notFound();

	const pages = await loadBrainPages(ctx);
	const page = pages.find((p) => p.slug === slug);
	if (!page) {
		const suggestions = await ctx.provider.search({
			query: slug.split("/").pop()?.replaceAll("-", " ") ?? slug,
			includeArchived: true,
			limit: 3,
		});
		return (
			<div className="max-w-xl space-y-3">
				<h1 className="text-2xl">No existe la página</h1>
				<p className="text-muted-foreground">
					<code>{slug}</code> no está en el brain.
				</p>
				{suggestions.length > 0 && (
					<ul className="list-disc pl-5">
						{suggestions.map((s) => (
							<li key={s.slug}>
								<Link className="underline" href={pageHref(tenantSlug, s.slug)}>
									{s.title}
								</Link>
							</li>
						))}
					</ul>
				)}
			</div>
		);
	}

	const index = buildLinkIndex(pages);
	const lookup = new Map(
		pages.map((p) => [p.slug, { title: p.title, status: p.status }]),
	);

	const level = ctx.access(slug);
	const outgoing = index.outgoing.get(slug) ?? [];
	const incoming = index.incoming.get(slug) ?? [];

	// Sin `key` derivada de la revisión: remontaría el editor tras cada
	// router.refresh() y perdería su historial de deshacer.
	if (entryMode(level) === "edit") {
		return (
			<PageWorkspace
				mode="edit"
				tenantSlug={tenantSlug}
				categories={ctx.categories}
				knownTags={[...new Set(pages.flatMap((p) => p.tags))]}
				pages={pages.map(({ slug: s, title, status }) => ({
					slug: s,
					title,
					status,
				}))}
				initial={{
					slug: page.slug,
					title: page.title,
					category: page.category,
					status: page.status,
					tags: page.tags,
					frontmatter: page.frontmatter,
					body: page.body,
					revision: page.revision,
				}}
				canDelete={level === "administrador"}
				facts={
					<PageFacts
						tenantSlug={tenantSlug}
						page={page}
						outgoing={outgoing}
						incoming={incoming}
						titleFor={(s) => lookup.get(s)?.title ?? s}
					/>
				}
			/>
		);
	}

	return (
		<ReadingView
			tenantSlug={tenantSlug}
			page={page}
			lookup={lookup}
			outgoing={outgoing}
			incoming={incoming}
			actions={
				<Button asChild variant="outline" className="min-h-11 lg:min-h-0">
					<Link href={historyHref(tenantSlug, slug)}>Historial</Link>
				</Button>
			}
		/>
	);
}
