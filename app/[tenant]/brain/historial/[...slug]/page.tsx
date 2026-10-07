import Link from "next/link";
import { notFound } from "next/navigation";
import { DiffView } from "@/components/brain/diff-view";
import { loadEditorContext, loadRevisions } from "@/lib/brain/adapters/editor";
import { atLeast } from "@/lib/brain/core/access/types";
import { diffLines, diffMeta } from "@/lib/brain/core/diff";
import {
	historyHref as historyPath,
	pageHref,
	slugFromParams,
} from "@/lib/brain/core/editor/slug";
import { RestoreButton } from "./restore-button";

const AUTHOR_LABEL = {
	user: "Persona",
	agent: "Agente",
	import: "Import",
} as const;
const FIELD_LABEL = {
	title: "Título",
	category: "Categoría",
	status: "Estado",
} as const;

export default async function HistoryPage({
	params,
	searchParams,
}: {
	params: Promise<{ tenant: string; slug: string[] }>;
	searchParams: Promise<{ rev?: string; contra?: string }>;
}) {
	const { tenant: tenantSlug, slug: segments } = await params;
	const { rev, contra } = await searchParams;
	const ctx = await loadEditorContext(tenantSlug);
	const slug = slugFromParams(segments);
	if (!ctx || ctx.kind !== "ok" || !slug) notFound();
	const revisions = await loadRevisions(ctx, slug);
	if (!revisions || revisions.length === 0) notFound();

	const current = revisions[0];
	const selected = revisions.find((r) => String(r.revision) === rev) ?? current;
	// Por defecto se compara contra la anterior; con ?contra=vigente, contra la vigente.
	const base =
		contra === "vigente"
			? current
			: (revisions.find((r) => r.revision === selected.revision - 1) ?? null);
	const meta = base ? diffMeta(base, selected) : null;
	const historyHref = (query: Record<string, string>) =>
		`${historyPath(tenantSlug, slug)}?${new URLSearchParams(query)}`;

	return (
		<div className="grid gap-8 lg:grid-cols-[280px_minmax(0,1fr)]">
			<aside>
				<Link
					href={pageHref(tenantSlug, slug)}
					className="text-muted-foreground text-sm"
				>
					← {current.title}
				</Link>
				<h1 className="mb-4 text-2xl">Historial</h1>
				<ol className="divide-y rounded-lg border text-sm">
					{revisions.map((r) => (
						<li key={r.revision}>
							<Link
								href={historyHref({ rev: String(r.revision) })}
								className={`block px-3 py-2 hover:bg-muted/50 ${r.revision === selected.revision ? "bg-muted" : ""}`}
							>
								<span className="font-medium">Rev. {r.revision}</span>{" "}
								<span className="rounded-full border px-1.5 text-xs">
									{AUTHOR_LABEL[r.authorKind]}
								</span>
								<span className="block text-muted-foreground text-xs">
									{new Date(r.createdAt).toLocaleString("es-AR")}
									{r.authorEmail ? ` · ${r.authorEmail}` : ""}
								</span>
								<span className="block truncate">{r.reason}</span>
							</Link>
						</li>
					))}
				</ol>
			</aside>
			<section className="min-w-0 space-y-4">
				<div className="flex flex-wrap items-center gap-3">
					<h2 className="mr-auto text-lg">
						Revisión {selected.revision}{" "}
						{base
							? `contra ${base === current ? "la vigente" : `la ${base.revision}`}`
							: "(la primera)"}
					</h2>
					{selected !== current && (
						<Link
							className="text-sm underline"
							href={historyHref({
								rev: String(selected.revision),
								...(contra === "vigente" ? {} : { contra: "vigente" }),
							})}
						>
							{contra === "vigente"
								? "Comparar con la anterior"
								: "Comparar con la vigente"}
						</Link>
					)}
					{atLeast(ctx.access(slug), "editor") && selected !== current && (
						<RestoreButton
							input={{
								tenantSlug,
								slug,
								title: selected.title,
								category: selected.category,
								status: selected.status,
								tags: selected.tags,
								frontmatter: selected.frontmatter,
								body: selected.body,
								reason: `Restaurada desde la revisión ${selected.revision}`,
								baseRevision: current.revision,
							}}
						/>
					)}
				</div>
				<p className="text-sm">
					<span className="text-muted-foreground">Motivo:</span>{" "}
					{selected.reason}
				</p>
				{meta &&
					(meta.changes.length > 0 ||
						meta.tagsAdded.length > 0 ||
						meta.tagsRemoved.length > 0) && (
						<ul className="space-y-1 rounded-md border p-3 text-sm">
							{meta.changes.map((c) => (
								<li key={c.field}>
									{FIELD_LABEL[c.field]}: <s>{c.from}</s> → {c.to}
								</li>
							))}
							{meta.tagsAdded.length > 0 && (
								<li>Tags agregados: {meta.tagsAdded.join(", ")}</li>
							)}
							{meta.tagsRemoved.length > 0 && (
								<li>Tags quitados: {meta.tagsRemoved.join(", ")}</li>
							)}
						</ul>
					)}
				<DiffView blocks={diffLines(base?.body ?? "", selected.body)} />
			</section>
		</div>
	);
}
