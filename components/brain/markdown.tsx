import Link from "next/link";
import ReactMarkdown, { defaultUrlTransform } from "react-markdown";
import remarkGfm from "remark-gfm";
import { toMarkdownLinks, WIKI_SCHEME } from "@/lib/brain/editor/markdown-links";
import { pageHref } from "@/lib/brain/editor/slug";
import type { BrainStatus } from "@/lib/brain/types";

export type PageLookup = Map<string, { title: string; status: BrainStatus }>;

// Sin rehype-raw: el agente también escribe páginas y el HTML del cuerpo se
// muestra como texto. El esquema wiki: se deja pasar solo para resolverlo acá.
export function BrainMarkdown({
	body,
	tenantSlug,
	pages,
}: {
	body: string;
	tenantSlug: string;
	pages: PageLookup;
}) {
	const source = toMarkdownLinks(body, (slug) => pages.get(slug)?.title);
	return (
		<div className="brain-prose">
			<ReactMarkdown
				remarkPlugins={[remarkGfm]}
				urlTransform={(url) =>
					url.startsWith(WIKI_SCHEME) ? url : defaultUrlTransform(url)
				}
				components={{
					a({ href = "", children }) {
						if (!href.startsWith(WIKI_SCHEME))
							return (
								<a href={href} target="_blank" rel="noreferrer">
									{children}
								</a>
							);
						const [slug, anchor] = href.slice(WIKI_SCHEME.length).split("#");
						const target = pages.get(slug);
						if (!target)
							return (
								<span
									className="cursor-help text-destructive underline decoration-dotted"
									title={`No existe la página ${slug}`}
								>
									{children}
								</span>
							);
						return (
							<Link
								href={`${pageHref(tenantSlug, slug)}${anchor ? `#${anchor}` : ""}`}
								className={target.status === "archivado" ? "opacity-60" : undefined}
								title={target.status === "archivado" ? "Archivada" : target.title}
							>
								{children}
							</Link>
						);
					},
				}}
			>
				{source}
			</ReactMarkdown>
		</div>
	);
}
