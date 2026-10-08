import Link from "next/link";
import type { ReactNode } from "react";
import { DetailsSheet } from "@/components/brain/details-sheet";
import { BrainMarkdown, type PageLookup } from "@/components/brain/markdown";
import { PageFacts } from "@/components/brain/page-facts";
import { Paper } from "@/components/brain/paper";
import type { OutgoingLink } from "@/lib/brain/core/links";
import type { BrainPage } from "@/lib/brain/core/types";

// Vista de lectura (spec 18.2 §6): título y cuerpo sobre la hoja; los datos van
// en el panel "Detalles". `actions` son los botones que decide la ruta.
export function ReadingView({
	tenantSlug,
	page,
	lookup,
	outgoing,
	incoming,
	actions,
}: {
	tenantSlug: string;
	page: BrainPage;
	lookup: PageLookup;
	outgoing: OutgoingLink[];
	incoming: string[];
	actions?: ReactNode;
}) {
	const titleFor = (slug: string) => lookup.get(slug)?.title ?? slug;
	return (
		<div className="space-y-4">
			<div className="flex flex-wrap items-center gap-3">
				<Link
					href={`/${tenantSlug}/brain`}
					className="mr-auto inline-flex min-h-11 items-center text-muted-foreground text-sm lg:min-h-0"
				>
					← Brain · <span className="capitalize">{page.category}</span>
				</Link>
				{actions}
				<DetailsSheet>
					<PageFacts
						tenantSlug={tenantSlug}
						page={page}
						outgoing={outgoing}
						incoming={incoming}
						titleFor={titleFor}
					/>
				</DetailsSheet>
			</div>
			<article>
				<Paper>
					<h1 className="mb-6 text-3xl leading-tight">{page.title}</h1>
					<BrainMarkdown
						body={page.body}
						tenantSlug={tenantSlug}
						pages={lookup}
					/>
				</Paper>
			</article>
		</div>
	);
}
