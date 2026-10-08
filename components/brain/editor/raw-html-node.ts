// HTML crudo dentro del markdown (spec 18.2 V10). El agente y el MCP escriben
// páginas, así que un <script> o un <img onerror> puede llegar como texto. El
// editor nunca lo vuelve elemento: lo guarda como un átomo con el texto original
// (`raw`), lo muestra como texto y lo devuelve byte a byte al guardar. Es lo
// mismo que hace la vista de lectura (sin rehype-raw).
import { Node } from "@tiptap/core";

export const RawHtml = Node.create({
	name: "rawHtml",
	group: "inline",
	inline: true,
	atom: true,
	selectable: true,

	addAttributes() {
		return { raw: { default: "" } };
	},

	parseHTML() {
		// El texto del span es el `raw`: sin esto, releer el HTML (copiar, pegar,
		// arrastrar) lo vaciaba. Siempre texto, nunca innerHTML.
		return [
			{
				tag: "span[data-raw-html]",
				getAttrs: (el) => ({ raw: (el as HTMLElement).textContent ?? "" }),
			},
		];
	},

	renderHTML({ node }) {
		return [
			"span",
			{ "data-raw-html": "true", class: "brain-raw-html" },
			String(node.attrs.raw ?? ""),
		];
	},

	parseMarkdown: (token: { raw?: string }) => ({
		type: "rawHtml",
		attrs: { raw: token.raw ?? "" },
	}),

	renderMarkdown: (node: { attrs?: Record<string, unknown> }) =>
		String(node.attrs?.raw ?? ""),
});
