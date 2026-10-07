import Link from "next/link";
import { notFound } from "next/navigation";
import { loadBrainPages, loadEditorContext } from "@/lib/brain/adapters/editor";
import { atLeast } from "@/lib/brain/core/access/types";
import { pageHref, slugFromParams } from "@/lib/brain/core/editor/slug";
import { PageForm } from "../../page-form";

export default async function EditBrainPage({
	params,
}: {
	params: Promise<{ tenant: string; slug: string[] }>;
}) {
	const { tenant: tenantSlug, slug: segments } = await params;
	const ctx = await loadEditorContext(tenantSlug);
	const slug = slugFromParams(segments);
	if (!ctx || ctx.kind !== "ok" || !slug) notFound();
	const level = ctx.access(slug);
	if (level === null) notFound();
	const pages = await loadBrainPages(ctx);
	const page = pages.find((p) => p.slug === slug);
	if (!page) notFound();
	if (!atLeast(level, "editor")) {
		return (
			<div className="max-w-xl space-y-3">
				<h1 className="text-3xl leading-tight">No podés editar esta página</h1>
				<p className="text-muted-foreground">
					Tenés permiso de lectura sobre <code>{slug}</code>. Pedile a un
					administrador que te dé permiso de edición.
				</p>
				<Link href={pageHref(tenantSlug, slug)} className="underline">
					Volver a la página
				</Link>
			</div>
		);
	}
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
