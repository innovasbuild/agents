import Link from "next/link";
import { notFound } from "next/navigation";
import { BrainNotice } from "@/components/brain/brain-notice";
import { PageList } from "@/components/brain/page-list";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
	loadBrainPages,
	loadBrainTree,
	loadEditorContext,
} from "@/lib/brain/adapters/editor";
import {
	editableFolders,
	type TreeNode,
	withoutArchived,
} from "@/lib/brain/core/access/tree";
import { buildLinkIndex } from "@/lib/brain/core/links";
import {
	BRAIN_STATUSES,
	type BrainStatus,
	CANON_TAGS,
	SLUG_PATTERN,
} from "@/lib/brain/core/types";

export default async function BrainIndexPage({
	params,
	searchParams,
}: {
	params: Promise<{ tenant: string }>;
	searchParams: Promise<{
		q?: string;
		estado?: string;
		tag?: string;
		carpeta?: string;
	}>;
}) {
	const { tenant: slug } = await params;
	const { q = "", estado, tag, carpeta } = await searchParams;
	const ctx = await loadEditorContext(slug);
	if (!ctx) notFound();
	if (ctx.kind !== "ok") return <BrainNotice kind={ctx.kind} />;

	const pages = await loadBrainPages(ctx);
	const index = buildLinkIndex(pages);
	const status = BRAIN_STATUSES.includes(estado as BrainStatus)
		? (estado as BrainStatus)
		: null;

	// Con consulta se ordena por relevancia con brain_search_pages; sin
	// consulta se lista todo sin buscar.
	let visible = pages;
	if (q.trim()) {
		const results = await ctx.provider.search({
			query: q.trim(),
			includeArchived: status === "archivado",
			limit: 20,
		});
		const order = new Map(results.map((r, i) => [r.slug, i]));
		visible = pages
			.filter((p) => order.has(p.slug))
			.sort((a, b) => (order.get(a.slug) ?? 0) - (order.get(b.slug) ?? 0));
	}
	visible = visible.filter((p) =>
		status ? p.status === status : p.status !== "archivado",
	);
	if (tag) visible = visible.filter((p) => p.tags.includes(tag));

	const folder = carpeta && SLUG_PATTERN.test(carpeta) ? carpeta : null;
	if (folder)
		visible = visible.filter(
			(p) => p.slug === folder || p.slug.startsWith(`${folder}/`),
		);

	const tree = await loadBrainTree(ctx);
	// Sin consulta, carpeta ni etiqueta: las carpetas de primer nivel y las páginas
	// sueltas. Con alguna, la lista plana de resultados.
	const browsing = !q.trim() && !tag && !folder;
	const folders = browsing
		? (status === "archivado" ? tree : withoutArchived(tree)).children.filter(
				(n) => n.children.length > 0,
			)
		: [];
	const countPages = (node: TreeNode): number =>
		(node.page ? 1 : 0) +
		node.children.reduce((sum, c) => sum + countPages(c), 0);
	const listed = browsing
		? visible.filter((p) => !p.slug.includes("/"))
		: visible;
	if (!q.trim()) listed.sort((a, b) => a.slug.localeCompare(b.slug));

	const counts = new Map(
		pages.map((p) => [
			p.slug,
			{
				in: index.incoming.get(p.slug)?.length ?? 0,
				out: index.outgoing.get(p.slug)?.length ?? 0,
			},
		]),
	);
	const href = (next: Record<string, string | undefined>) => {
		const sp = new URLSearchParams();
		for (const [k, v] of Object.entries({
			q: q || undefined,
			estado,
			tag,
			carpeta: folder ?? undefined,
			...next,
		}))
			if (v) sp.set(k, v);
		const qs = sp.toString();
		return `/${slug}/brain${qs ? `?${qs}` : ""}`;
	};

	return (
		<div className="space-y-6">
			<div className="flex flex-wrap items-center gap-3">
				<h1 className="mr-auto text-3xl leading-tight">
					Brain{folder ? ` / ${folder}` : ""}
				</h1>
				<Button asChild variant="outline">
					<Link href={`/${slug}/brain/mapa`}>Mapa de conexiones</Link>
				</Button>
				{editableFolders(tree).length > 0 && (
					<Button asChild className="lg:hidden">
						<Link href={`/${slug}/brain/nueva`}>Nueva página</Link>
					</Button>
				)}
			</div>
			{folder && (
				<Link
					href={href({ carpeta: undefined })}
					className="inline-flex min-h-11 items-center text-muted-foreground text-sm underline"
				>
					Quitar filtro de carpeta
				</Link>
			)}
			<form className="flex flex-wrap gap-2" action={`/${slug}/brain`}>
				<Input
					name="q"
					defaultValue={q}
					placeholder="Buscar en el brain"
					className="max-w-sm"
				/>
				<select
					name="estado"
					defaultValue={status ?? ""}
					className="h-9 rounded-md border bg-background px-3 text-sm"
				>
					<option value="">Activas y borradores</option>
					<option value="activo">Activas</option>
					<option value="borrador">Borradores</option>
					<option value="archivado">Archivadas</option>
				</select>
				{tag && <input type="hidden" name="tag" value={tag} />}
				{folder && <input type="hidden" name="carpeta" value={folder} />}
				<Button type="submit" variant="secondary">
					Buscar
				</Button>
			</form>
			<div className="flex flex-wrap gap-2 text-sm">
				{CANON_TAGS.map((t) => (
					<Link
						key={t}
						href={href({ tag: tag === t ? undefined : t })}
						className={`rounded-full border px-3 py-1 ${tag === t ? "bg-primary text-primary-foreground" : ""}`}
					>
						{t}
					</Link>
				))}
			</div>
			{folders.length > 0 && (
				<ul className="divide-y rounded-lg border">
					{folders.map((node) => (
						<li key={node.path}>
							<Link
								href={href({ carpeta: node.path })}
								className="flex min-h-11 items-center gap-3 px-4 py-2 hover:bg-muted/50"
							>
								<span className="min-w-0 flex-1 truncate font-medium">
									{node.name}
								</span>
								<span className="text-muted-foreground text-xs">
									{countPages(node)}{" "}
									{countPages(node) === 1 ? "página" : "páginas"}
								</span>
							</Link>
						</li>
					))}
				</ul>
			)}
			{(listed.length > 0 || folders.length === 0) && (
				<PageList pages={listed} tenantSlug={slug} counts={counts} />
			)}
		</div>
	);
}
