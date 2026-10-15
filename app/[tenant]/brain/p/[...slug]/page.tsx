import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { PageWorkspace } from "@/components/brain/editor/page-workspace";
import { PageFacts } from "@/components/brain/page-facts";
import { ReadingView } from "@/components/brain/reading-view";
import { PublishedFiles } from "@/components/brain/skills/published-files";
import { SkillPanel } from "@/components/brain/skills/skill-panel";
import { Button } from "@/components/ui/button";
import {
	loadBrainPages,
	loadEditorContext,
	loadPageRulesPanel,
} from "@/lib/brain/adapters/editor";
import { skillStore } from "@/lib/brain/adapters/skills";
import { isAdminRole } from "@/lib/brain/core/access/types";
import { entryMode } from "@/lib/brain/core/editor/entry-mode";
import { entryLevel } from "@/lib/brain/core/editor/reserved";
import {
	historyHref,
	pageHref,
	slugFromParams,
} from "@/lib/brain/core/editor/slug";
import { buildLinkIndex } from "@/lib/brain/core/links";
import { isSkillSlug } from "@/lib/brain/core/skills/package";
import { publishedSnapshot, skillState } from "@/lib/brain/core/skills/state";

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

	// Una reservada se edita solo administrando su carpeta (spec etapa 26
	// §4.1); para los demás es lectura. El servidor lo exige igual al guardar.
	const level = entryLevel(slug, ctx.access);
	const outgoing = index.outgoing.get(slug) ?? [];
	const incoming = index.incoming.get(slug) ?? [];

	// Una skill suma su panel (quien edita) o sus archivos publicados (quien lee).
	const skillRow = isSkillSlug(slug)
		? (await ctx.skills()).find((row) => row.slug === slug)
		: undefined;

	// Sin `key` derivada de la revisión: remontaría el editor tras cada
	// router.refresh() y perdería su historial de deshacer.
	if (entryMode(level) === "edit") {
		const rules = await loadPageRulesPanel(ctx, slug);
		let skill: ReactNode;
		if (skillRow) {
			const store = skillStore();
			const [files, acts] = await Promise.all([
				store.files(ctx.tenant.id, skillRow.pageId),
				store.acts(ctx.tenant.id, skillRow.pageId),
			]);
			skill = (
				<SkillPanel
					tenantSlug={tenantSlug}
					slug={slug}
					state={skillState(skillRow)}
					files={files}
					versions={acts.map((act) => ({
						id: act.id,
						action: act.action,
						version: act.version,
						note: act.note,
						createdAt: act.createdAt,
						republishedFrom: act.republishedFrom,
					}))}
					canPublish={isAdminRole(ctx.tenant.role)}
				/>
			);
		}
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
				skill={skill}
				rules={rules}
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

	const published = publishedSnapshot(skillRow);

	return (
		<div className="space-y-6">
			<ReadingView
				tenantSlug={tenantSlug}
				page={page}
				lookup={lookup}
				outgoing={outgoing}
				incoming={incoming}
				actions={
					// El historial de una skill es el de su borrador: no es para lectores.
					skillRow ? undefined : (
						<Button asChild variant="outline" className="min-h-11 lg:min-h-0">
							<Link href={historyHref(tenantSlug, slug)}>Historial</Link>
						</Button>
					)
				}
			/>
			{published && (
				<PublishedFiles
					tenantSlug={tenantSlug}
					slug={slug}
					version={published.version}
					files={published.manifest}
				/>
			)}
		</div>
	);
}
