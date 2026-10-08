// Nodo de link del brain para Tiptap (spec 18.2 V9). Lee y escribe los
// wikilinks [[slug]], [[slug|alias]] y [[slug#ancla|alias]]. Guarda el texto
// original (`raw`) y lo devuelve tal cual mientras no se edite el nodo, para que
// abrir y guardar una página no cambie ni un carácter de sus links.
import { mergeAttributes, Node } from "@tiptap/core";
import { CODE_PATTERN, WIKILINK_PATTERN } from "@/lib/brain/core/wikilinks";

export interface WikiLinkOptions {
	titleFor: (slug: string) => string | undefined;
	exists: (slug: string) => boolean;
}

const WIKILINK_AT_START = /^\[\[([^\]|#]+)(#[^\]|]*)?(?:\|([^\]]+))?\]\]/;

// GFM parte las celdas de una tabla por cada `|` antes de mirar el contenido, y
// un [[slug|alias]] en una celda se rompería en dos. Antes de que `marked` lea
// la tabla, el `|` de cada link (fuera de código) pasa a un carácter de
// reemplazo del mismo largo; el tokenizador lo devuelve a `|`.
const PIPE_PLACEHOLDER = "\u0001";

function protectChunk(chunk: string): string {
	return chunk.replace(WIKILINK_PATTERN, (link) =>
		link.replaceAll("|", PIPE_PLACEHOLDER),
	);
}

export function protectWikilinkPipes(src: string): string {
	let out = "";
	let cursor = 0;
	for (const match of src.matchAll(CODE_PATTERN)) {
		const start = match.index ?? 0;
		out += protectChunk(src.slice(cursor, start)) + match[0];
		cursor = start + match[0].length;
	}
	return out + protectChunk(src.slice(cursor));
}

const restorePipes = (text: string) => text.replaceAll(PIPE_PLACEHOLDER, "|");
export const unprotectWikilinkPipes = restorePipes;

export function canonicalWikiLink(attrs: {
	target: string;
	anchor: string | null;
	alias: string | null;
}): string {
	const anchor = attrs.anchor ? `#${attrs.anchor}` : "";
	const alias = attrs.alias ? `|${attrs.alias}` : "";
	return `[[${attrs.target}${anchor}${alias}]]`;
}

export const WikiLink = Node.create<WikiLinkOptions>({
	name: "wikiLink",
	group: "inline",
	inline: true,
	atom: true,
	selectable: true,

	addOptions() {
		return { titleFor: () => undefined, exists: () => true };
	},

	addAttributes() {
		return {
			target: { default: "" },
			anchor: { default: null },
			alias: { default: null },
			raw: { default: null },
		};
	},

	parseHTML() {
		return [{ tag: "span[data-wikilink]" }];
	},

	renderHTML({ node, HTMLAttributes }) {
		const { target, alias } = node.attrs as {
			target: string;
			alias: string | null;
		};
		const label = alias ?? this.options.titleFor(target) ?? target;
		const broken = !this.options.exists(target);
		return [
			"span",
			mergeAttributes(HTMLAttributes, {
				"data-wikilink": target,
				"data-broken": broken ? "true" : undefined,
				title: broken ? `No existe la página ${target}` : target,
				class: "brain-wikilink",
			}),
			label,
		];
	},

	markdownTokenizer: {
		name: "wikiLink",
		level: "inline",
		start: (src: string) => src.indexOf("[["),
		tokenize: (src: string) => {
			const match = WIKILINK_AT_START.exec(src);
			if (!match) return undefined;
			return {
				type: "wikiLink",
				raw: restorePipes(match[0]),
				target: match[1].trim(),
				anchor: match[2] ? match[2].slice(1).trim() || null : null,
				alias: match[3] ? restorePipes(match[3]).trim() || null : null,
			};
		},
	},

	parseMarkdown: (token: {
		raw?: string;
		target?: string;
		anchor?: string | null;
		alias?: string | null;
	}) => ({
		type: "wikiLink",
		attrs: {
			target: token.target ?? "",
			anchor: token.anchor ?? null,
			alias: token.alias ?? null,
			raw: token.raw ?? null,
		},
	}),

	renderMarkdown: (node: { attrs?: Record<string, unknown> }) => {
		const attrs = (node.attrs ?? {}) as {
			target: string;
			anchor: string | null;
			alias: string | null;
			raw: string | null;
		};
		return attrs.raw ?? canonicalWikiLink(attrs);
	},
});
