import Link from "next/link";
import { pageHref } from "@/lib/brain/core/editor/slug";
import { type BrainPage, CANON_TAGS } from "@/lib/brain/core/types";

const STATUS_LABEL = {
	activo: "Activo",
	borrador: "Borrador",
	archivado: "Archivado",
} as const;

// Lista plana con la ruta de cada página: el árbol de la izquierda es la
// estructura; acá no se agrupa por categoría (A13), que queda como insignia.
export function PageList({
	pages,
	tenantSlug,
	counts,
}: {
	pages: BrainPage[];
	tenantSlug: string;
	counts: Map<string, { in: number; out: number }>;
}) {
	if (pages.length === 0)
		return (
			<p className="text-muted-foreground">No hay páginas que coincidan.</p>
		);
	return (
		<ul className="divide-y rounded-lg border">
			{pages.map((page) => {
				const count = counts.get(page.slug) ?? { in: 0, out: 0 };
				const canon = page.tags.filter((t) =>
					(CANON_TAGS as readonly string[]).includes(t),
				);
				return (
					<li key={page.slug}>
						<Link
							href={pageHref(tenantSlug, page.slug)}
							className="flex min-h-11 flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2 hover:bg-muted/50"
						>
							<span className="min-w-0 flex-1">
								<span className="block truncate font-medium">{page.title}</span>
								<span className="block truncate text-muted-foreground text-xs">
									{page.slug}
								</span>
							</span>
							<span className="rounded-full border px-2 py-0.5 text-xs capitalize">
								{page.category}
							</span>
							{canon.map((tag) => (
								<span
									key={tag}
									className="rounded-full border px-2 py-0.5 text-xs"
								>
									{tag}
								</span>
							))}
							{page.status !== "activo" && (
								<span className="rounded-full bg-muted px-2 py-0.5 text-xs">
									{STATUS_LABEL[page.status]}
								</span>
							)}
							<span
								className="text-muted-foreground text-xs tabular-nums"
								title="Links entrantes · salientes"
							>
								← {count.in} · {count.out} →
							</span>
						</Link>
					</li>
				);
			})}
		</ul>
	);
}
