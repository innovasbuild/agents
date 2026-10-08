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

const INVALID_TARGET = /[[\]|#\n\r]/;
const INVALID_ANCHOR = /[[\]|#\n\r]/;
const INVALID_ALIAS = /[[\]|\n\r]/;

// Valor de un atributo pegado como string recortado; null si está vacío o es inválido.
function cleanAttr(el: HTMLElement, name: string, invalid: RegExp | null) {
	const value = String(el.getAttribute(name) ?? "").trim();
	return !value || invalid?.test(value) ? null : value;
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
	// Defensa en profundidad: lo que rompería el link o metería texto se descarta.
	const anchor =
		attrs.anchor && !INVALID_ANCHOR.test(attrs.anchor)
			? `#${attrs.anchor}`
			: "";
	const alias =
		attrs.alias && !INVALID_ALIAS.test(attrs.alias) ? `|${attrs.alias}` : "";
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
			target: {
				default: "",
				parseHTML: (el: HTMLElement) => cleanAttr(el, "target", null),
			},
			anchor: {
				default: null,
				parseHTML: (el: HTMLElement) => cleanAttr(el, "anchor", INVALID_ANCHOR),
			},
			alias: {
				default: null,
				parseHTML: (el: HTMLElement) => cleanAttr(el, "alias", INVALID_ALIAS),
			},
			// Solo se conserva el raw pegado si es exactamente el link que dicen los
			// demás atributos; si no, se escribe la forma canónica.
			raw: {
				default: null,
				parseHTML: (el: HTMLElement) => {
					const raw = el.getAttribute("raw");
					const m = raw ? WIKILINK_AT_START.exec(raw) : null;
					if (!raw || !m || m[0] !== raw) return null;
					const same =
						m[1].trim() === (el.getAttribute("target") ?? "").trim() &&
						(m[2] ? m[2].slice(1).trim() || null : null) ===
							cleanAttr(el, "anchor", INVALID_ANCHOR) &&
						(m[3] ? m[3].trim() || null : null) ===
							cleanAttr(el, "alias", INVALID_ALIAS);
					return same ? raw : null;
				},
			},
		};
	},

	parseHTML() {
		return [
			{
				tag: "span[data-wikilink]",
				getAttrs: (el) => {
					const target =
						(el as HTMLElement).getAttribute("target")?.trim() ?? "";
					return !target || INVALID_TARGET.test(target) ? false : {};
				},
			},
		];
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
