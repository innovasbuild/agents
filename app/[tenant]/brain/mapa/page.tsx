import Link from "next/link";
import { notFound } from "next/navigation";
import { BrainNotice } from "@/components/brain/brain-notice";
import { loadBrainPages, loadEditorContext } from "@/lib/brain/adapters/editor";
import { pageHref } from "@/lib/brain/core/editor/slug";
import { buildLinkIndex } from "@/lib/brain/core/links";

const HUBS_PER_CATEGORY = 5;

export default async function BrainMapPage({
	params,
}: {
	params: Promise<{ tenant: string }>;
}) {
	const { tenant: slug } = await params;
	const ctx = await loadEditorContext(slug);
	if (!ctx) notFound();
	if (ctx.kind !== "ok") return <BrainNotice kind={ctx.kind} />;

	const pages = await loadBrainPages(ctx);
	const index = buildLinkIndex(pages);
	const title = new Map(pages.map((p) => [p.slug, p.title]));
	const live = pages.filter((p) => p.status !== "archivado");
	const orphans = new Set(index.orphans);

	return (
		<div className="space-y-10">
			<div>
				<Link href={`/${slug}/brain`} className="text-muted-foreground text-sm">
					← Brain
				</Link>
				<h1 className="text-3xl leading-tight">Mapa de conexiones</h1>
				<p className="text-muted-foreground text-sm">
					{live.length} páginas · {index.orphans.length} huérfanas ·{" "}
					{index.broken.length} links rotos
				</p>
			</div>

			<section>
				<h2 className="mb-3 text-lg">Por categoría</h2>
				<div className="grid gap-4 md:grid-cols-2">
					{ctx.categories.map((category) => {
						const inCat = live.filter((p) => p.category === category);
						if (inCat.length === 0) return null;
						const hubs = [...inCat]
							.sort(
								(a, b) =>
									(index.incoming.get(b.slug)?.length ?? 0) -
									(index.incoming.get(a.slug)?.length ?? 0),
							)
							.slice(0, HUBS_PER_CATEGORY)
							.filter((p) => (index.incoming.get(p.slug)?.length ?? 0) > 0);
						const lonely = inCat.filter((p) => orphans.has(p.slug));
						return (
							<div key={category} className="rounded-lg border p-4">
								<h3 className="mb-2 font-medium capitalize">
									{category}{" "}
									<span className="text-muted-foreground text-sm">
										({inCat.length})
									</span>
								</h3>
								<p className="mb-1 text-muted-foreground text-xs uppercase">
									Más enlazadas
								</p>
								<ul className="mb-3 space-y-1 text-sm">
									{hubs.length === 0 && (
										<li className="text-muted-foreground">
											Ninguna página de esta categoría está enlazada.
										</li>
									)}
									{hubs.map((p) => (
										<li key={p.slug}>
											<Link className="underline" href={pageHref(slug, p.slug)}>
												{p.title}
											</Link>{" "}
											<span className="text-muted-foreground">
												← {index.incoming.get(p.slug)?.length}
											</span>
										</li>
									))}
								</ul>
								{lonely.length > 0 && (
									<>
										<p className="mb-1 text-muted-foreground text-xs uppercase">
											Huérfanas
										</p>
										<ul className="space-y-1 text-sm">
											{lonely.map((p) => (
												<li key={p.slug}>
													<Link
														className="underline"
														href={pageHref(slug, p.slug)}
													>
														{p.title}
													</Link>
												</li>
											))}
										</ul>
									</>
								)}
							</div>
						);
					})}
				</div>
			</section>

			<section>
				<h2 className="mb-3 text-lg">Links rotos</h2>
				{index.broken.length === 0 ? (
					<p className="text-muted-foreground">No hay links rotos.</p>
				) : (
					<ul className="divide-y rounded-lg border text-sm">
						{index.broken.map((b) => (
							<li
								key={`${b.source}->${b.target}`}
								className="flex flex-wrap gap-2 px-4 py-2"
							>
								<Link className="underline" href={pageHref(slug, b.source)}>
									{title.get(b.source) ?? b.source}
								</Link>
								<span className="text-muted-foreground">apunta a</span>
								<code className="text-destructive">{b.target}</code>
							</li>
						))}
					</ul>
				)}
			</section>
		</div>
	);
}
