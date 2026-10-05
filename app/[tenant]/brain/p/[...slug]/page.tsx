import Link from "next/link";
import { notFound } from "next/navigation";
import { ConnectionsPanel } from "@/components/brain/connections-panel";
import { BrainMarkdown } from "@/components/brain/markdown";
import { Button } from "@/components/ui/button";
import { loadBrainPages, loadEditorContext } from "@/lib/brain/adapters/editor";
import { getBrainProvider } from "@/lib/brain/adapters/provider";
import {
	editHref,
	historyHref,
	pageHref,
	slugFromParams,
} from "@/lib/brain/core/editor/slug";
import { buildLinkIndex } from "@/lib/brain/core/links";
import { resolveBrainBinding } from "@/lib/brain/core/resolve";
import { loadTenantBindings } from "@/lib/connectors/bindings";

const STATUS_LABEL = {
	activo: "Activo",
	borrador: "Borrador",
	archivado: "Archivado",
} as const;

export default async function BrainPageView({
	params,
}: {
	params: Promise<{ tenant: string; slug: string[] }>;
}) {
	const { tenant: tenantSlug, slug: segments } = await params;
	const ctx = await loadEditorContext(tenantSlug);
	const slug = slugFromParams(segments);
	if (!ctx || ctx.kind !== "ok" || !slug) notFound();

	const pages = await loadBrainPages(ctx.tenant.id);
	const page = pages.find((p) => p.slug === slug);
	if (!page) {
		const binding = await resolveBrainBinding(
			ctx.tenant.id,
			loadTenantBindings,
		);
		const suggestions = binding
			? await getBrainProvider(binding).search({
					query: slug.split("/").pop()?.replaceAll("-", " ") ?? slug,
					includeArchived: true,
					limit: 3,
				})
			: [];
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
	const titleFor = (s: string) => lookup.get(s)?.title ?? s;

	return (
		<div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_280px]">
			<article className="min-w-0">
				<Link
					href={`/${tenantSlug}/brain`}
					className="text-muted-foreground text-sm"
				>
					← Brain · <span className="capitalize">{page.category}</span>
				</Link>
				<div className="mb-6 flex flex-wrap items-start gap-3">
					<h1 className="mr-auto text-3xl leading-tight">{page.title}</h1>
					<Button asChild variant="outline">
						<Link href={historyHref(tenantSlug, slug)}>Historial</Link>
					</Button>
					{ctx.canEdit && (
						<Button asChild>
							<Link href={editHref(tenantSlug, slug)}>Editar</Link>
						</Button>
					)}
				</div>
				<BrainMarkdown
					body={page.body}
					tenantSlug={tenantSlug}
					pages={lookup}
				/>
			</article>
			<aside className="space-y-6 border-t pt-6 lg:border-t-0 lg:border-l lg:pt-0 lg:pl-6">
				<dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
					<dt className="text-muted-foreground">Estado</dt>
					<dd>{STATUS_LABEL[page.status]}</dd>
					<dt className="text-muted-foreground">Categoría</dt>
					<dd className="capitalize">{page.category}</dd>
					<dt className="text-muted-foreground">Revisión</dt>
					<dd>{page.revision}</dd>
					<dt className="text-muted-foreground">Editada</dt>
					<dd>{new Date(page.updatedAt).toLocaleDateString("es-AR")}</dd>
					<dt className="text-muted-foreground">Slug</dt>
					<dd className="break-all">
						<code>{page.slug}</code>
					</dd>
				</dl>
				{page.tags.length > 0 && (
					<div className="flex flex-wrap gap-1">
						{page.tags.map((t) => (
							<Link
								key={t}
								href={`/${tenantSlug}/brain?tag=${encodeURIComponent(t)}`}
								className="rounded-full border px-2 py-0.5 text-xs"
							>
								{t}
							</Link>
						))}
					</div>
				)}
				<ConnectionsPanel
					tenantSlug={tenantSlug}
					outgoing={index.outgoing.get(slug) ?? []}
					incoming={index.incoming.get(slug) ?? []}
					titleFor={titleFor}
				/>
			</aside>
		</div>
	);
}
