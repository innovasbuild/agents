import Link from "next/link";
import { notFound } from "next/navigation";
import { DeletePageButton } from "@/components/brain/delete-page-button";
import { ReadingView } from "@/components/brain/reading-view";
import { Button } from "@/components/ui/button";
import { loadBrainPages, loadEditorContext } from "@/lib/brain/adapters/editor";
import { atLeast } from "@/lib/brain/core/access/types";
import {
	editHref,
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

	return (
		<ReadingView
			tenantSlug={tenantSlug}
			page={page}
			lookup={lookup}
			outgoing={index.outgoing.get(slug) ?? []}
			incoming={index.incoming.get(slug) ?? []}
			actions={
				<>
					<Button asChild variant="outline">
						<Link href={historyHref(tenantSlug, slug)}>Historial</Link>
					</Button>
					{ctx.access(slug) === "administrador" && (
						<DeletePageButton
							tenantSlug={tenantSlug}
							slug={slug}
							title={page.title}
						/>
					)}
					{atLeast(ctx.access(slug), "editor") && (
						<Button asChild>
							<Link href={editHref(tenantSlug, slug)}>Editar</Link>
						</Button>
					)}
				</>
			}
		/>
	);
}
