import Link from "next/link";
import type { BrainPageRow } from "@/lib/brain/adapters/editor";
import { pageHref } from "@/lib/brain/core/editor/slug";
import { CANON_TAGS } from "@/lib/brain/core/types";

const STATUS_LABEL = {
	activo: "Activo",
	borrador: "Borrador",
	archivado: "Archivado",
} as const;

export function PageList({
	groups,
	tenantSlug,
	counts,
}: {
	groups: { category: string; pages: BrainPageRow[] }[];
	tenantSlug: string;
	counts: Map<string, { in: number; out: number }>;
}) {
	if (groups.every((g) => g.pages.length === 0))
		return (
			<p className="text-muted-foreground">No hay páginas que coincidan.</p>
		);
	return (
		<div className="space-y-8">
			{groups
				.filter((g) => g.pages.length > 0)
				.map((group) => (
					<section key={group.category}>
						<h2 className="mb-2 text-lg capitalize">
							{group.category}{" "}
							<span className="text-muted-foreground text-sm">
								({group.pages.length})
							</span>
						</h2>
						<ul className="divide-y rounded-lg border">
							{group.pages.map((page) => {
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
												<span className="block truncate font-medium">
													{page.title}
												</span>
												<span className="block truncate text-muted-foreground text-xs">
													{page.slug}
												</span>
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
					</section>
				))}
		</div>
	);
}
