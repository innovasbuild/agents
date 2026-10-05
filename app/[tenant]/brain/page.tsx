import Link from "next/link";
import { notFound } from "next/navigation";
import { BrainNotice } from "@/components/brain/brain-notice";
import { PageList } from "@/components/brain/page-list";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { loadBrainPages, loadEditorContext } from "@/lib/brain/adapters/editor";
import { getBrainProvider } from "@/lib/brain/adapters/provider";
import { buildLinkIndex } from "@/lib/brain/core/links";
import { resolveBrainBinding } from "@/lib/brain/core/resolve";
import {
	BRAIN_STATUSES,
	type BrainStatus,
	CANON_TAGS,
} from "@/lib/brain/core/types";
import { loadTenantBindings } from "@/lib/connectors/bindings";

export default async function BrainIndexPage({
	params,
	searchParams,
}: {
	params: Promise<{ tenant: string }>;
	searchParams: Promise<{ q?: string; estado?: string; tag?: string }>;
}) {
	const { tenant: slug } = await params;
	const { q = "", estado, tag } = await searchParams;
	const ctx = await loadEditorContext(slug);
	if (!ctx) notFound();
	if (ctx.kind !== "ok") return <BrainNotice kind={ctx.kind} />;

	const pages = await loadBrainPages(ctx.tenant.id);
	const index = buildLinkIndex(pages);
	const status = BRAIN_STATUSES.includes(estado as BrainStatus)
		? (estado as BrainStatus)
		: null;

	// Con consulta se ordena por relevancia con brain_search_pages; sin
	// consulta se lista todo sin buscar.
	let visible = pages;
	if (q.trim()) {
		const binding = await resolveBrainBinding(
			ctx.tenant.id,
			loadTenantBindings,
		);
		const results = binding
			? await getBrainProvider(binding).search({
					query: q.trim(),
					includeArchived: status === "archivado",
					limit: 20,
				})
			: [];
		const order = new Map(results.map((r, i) => [r.slug, i]));
		visible = pages
			.filter((p) => order.has(p.slug))
			.sort((a, b) => (order.get(a.slug) ?? 0) - (order.get(b.slug) ?? 0));
	}
	visible = visible.filter((p) =>
		status ? p.status === status : p.status !== "archivado",
	);
	if (tag) visible = visible.filter((p) => p.tags.includes(tag));

	const counts = new Map(
		pages.map((p) => [
			p.slug,
			{
				in: index.incoming.get(p.slug)?.length ?? 0,
				out: index.outgoing.get(p.slug)?.length ?? 0,
			},
		]),
	);
	const groups = ctx.categories.map((category) => ({
		category,
		pages: visible.filter((p) => p.category === category),
	}));
	const href = (next: Record<string, string | undefined>) => {
		const sp = new URLSearchParams();
		for (const [k, v] of Object.entries({
			q: q || undefined,
			estado,
			tag,
			...next,
		}))
			if (v) sp.set(k, v);
		const qs = sp.toString();
		return `/${slug}/brain${qs ? `?${qs}` : ""}`;
	};

	return (
		<div className="space-y-6">
			<div className="flex flex-wrap items-center gap-3">
				<h1 className="mr-auto text-3xl leading-tight">Brain</h1>
				<Button asChild variant="outline">
					<Link href={`/${slug}/brain/mapa`}>Mapa de conexiones</Link>
				</Button>
				{ctx.canEdit && (
					<Button asChild>
						<Link href={`/${slug}/brain/nueva`}>Nueva página</Link>
					</Button>
				)}
			</div>
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
			<PageList groups={groups} tenantSlug={slug} counts={counts} />
		</div>
	);
}
