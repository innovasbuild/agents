import Link from "next/link";
import { pageHref } from "@/lib/brain/core/editor/slug";
import type { OutgoingLink } from "@/lib/brain/core/links";

export function ConnectionsPanel({
	tenantSlug,
	outgoing,
	incoming,
	titleFor,
}: {
	tenantSlug: string;
	outgoing: OutgoingLink[];
	incoming: string[];
	titleFor: (slug: string) => string;
}) {
	return (
		<div className="space-y-5 text-sm">
			<div>
				<h2 className="mb-1 font-medium">Enlaza a ({outgoing.length})</h2>
				{outgoing.length === 0 ? (
					<p className="text-muted-foreground">No enlaza a ninguna página.</p>
				) : (
					<ul className="space-y-1">
						{outgoing.map((link) => (
							<li key={link.target}>
								{link.broken ? (
									<span className="text-destructive" title="No existe">
										{link.target} (no existe)
									</span>
								) : (
									<Link
										className={`underline ${link.archived ? "opacity-60" : ""}`}
										href={pageHref(tenantSlug, link.target)}
									>
										{titleFor(link.target)}
										{link.archived ? " (archivada)" : ""}
									</Link>
								)}
							</li>
						))}
					</ul>
				)}
			</div>
			<div>
				<h2 className="mb-1 font-medium">La enlazan ({incoming.length})</h2>
				{incoming.length === 0 ? (
					<p className="text-muted-foreground">Ninguna página la enlaza.</p>
				) : (
					<ul className="space-y-1">
						{incoming.map((source) => (
							<li key={source}>
								<Link className="underline" href={pageHref(tenantSlug, source)}>
									{titleFor(source)}
								</Link>
							</li>
						))}
					</ul>
				)}
			</div>
		</div>
	);
}
