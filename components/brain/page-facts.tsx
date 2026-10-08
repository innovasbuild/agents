import Link from "next/link";
import { ConnectionsPanel } from "@/components/brain/connections-panel";
import type { OutgoingLink } from "@/lib/brain/core/links";
import type { BrainPage } from "@/lib/brain/core/types";

const STATUS_LABEL = {
	activo: "Activo",
	borrador: "Borrador",
	archivado: "Archivado",
} as const;

export function PageFacts({
	tenantSlug,
	page,
	outgoing,
	incoming,
	titleFor,
}: {
	tenantSlug: string;
	page: BrainPage;
	outgoing: OutgoingLink[];
	incoming: string[];
	titleFor: (slug: string) => string;
}) {
	return (
		<div className="space-y-6">
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
					{page.tags.map((tag) => (
						<Link
							key={tag}
							href={`/${tenantSlug}/brain?tag=${encodeURIComponent(tag)}`}
							className="rounded-full border px-2 py-0.5 text-xs"
						>
							{tag}
						</Link>
					))}
				</div>
			)}
			<ConnectionsPanel
				tenantSlug={tenantSlug}
				outgoing={outgoing}
				incoming={incoming}
				titleFor={titleFor}
			/>
		</div>
	);
}
