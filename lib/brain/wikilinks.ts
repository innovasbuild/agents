// Wikilinks del brain: [[slug]], [[slug|alias]], [[slug#ancla|alias]]. Los
// comparten el import (que los reescribe a slugs canónicos) y el editor (que
// arma conexiones y los renderiza). Sin imports: lo usa un script con Node.

export const WIKILINK_PATTERN = /\[\[([^\]|#]+)(#[^\]|]*)?(?:\|([^\]]+))?\]\]/g;

export interface Wikilink {
	target: string;
	anchor: string | null;
	alias: string | null;
	start: number;
	end: number;
}

export function parseWikilinks(body: string): Wikilink[] {
	const links: Wikilink[] = [];
	for (const match of body.matchAll(WIKILINK_PATTERN)) {
		const start = match.index ?? 0;
		links.push({
			target: match[1].trim(),
			anchor: match[2] ? match[2].slice(1).trim() || null : null,
			alias: match[3]?.trim() || null,
			start,
			end: start + match[0].length,
		});
	}
	return links;
}
