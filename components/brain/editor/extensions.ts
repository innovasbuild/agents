// Conjunto de extensiones del editor del brain (spec 18.2 §4). Una sola función
// para que el editor de la pantalla y la prueba de ida y vuelta usen lo mismo.
import type { Extensions } from "@tiptap/core";
import { Image } from "@tiptap/extension-image";
import { renderTableToMarkdown, Table } from "@tiptap/extension-table";
import { TableCell } from "@tiptap/extension-table-cell";
import { TableHeader } from "@tiptap/extension-table-header";
import { TableRow } from "@tiptap/extension-table-row";
import { TaskItem } from "@tiptap/extension-task-item";
import { TaskList } from "@tiptap/extension-task-list";
import { Markdown } from "@tiptap/markdown";
import StarterKit from "@tiptap/starter-kit";
import { Marked, type marked, Tokenizer, type Tokens } from "marked";
import { RawHtml } from "./raw-html-node";
import {
	protectWikilinkPipes,
	unprotectWikilinkPipes,
	WikiLink,
} from "./wikilink-node";

export interface EditorLookups {
	titleFor: (slug: string) => string | undefined;
	exists: (slug: string) => boolean;
}

// El HTML crudo (<script>, <img onerror>, <div onclick>) llega como markdown
// porque lo escriben el agente y el MCP. El editor no lo interpreta: cada
// etiqueta pasa a un nodo RawHtml con el texto original, así no se convierte en
// elemento ni se pierde (ni se re-escapa) al guardar.
// Los tokens propios (rawHtml) no están en los tipos de `marked`: se tipan acá.
const asRawHtml = (raw: string) =>
	({ type: "rawHtml", raw, text: raw }) as unknown as Tokens.Tag;

const brainMarked = new Marked({
	gfm: true,
	tokenizer: {
		tag(src) {
			const token = Tokenizer.prototype.tag.call(this, src);
			return token ? asRawHtml(token.raw) : token;
		},
		html(src) {
			const token = Tokenizer.prototype.html.call(this, src);
			if (!token) return token;
			const raw = token.raw.replace(/\n+$/, "");
			return {
				type: "paragraph",
				raw: token.raw,
				text: raw,
				tokens: [asRawHtml(raw)],
			} as unknown as Tokens.HTML;
		},
		table(src) {
			return Tokenizer.prototype.table.call(this, protectWikilinkPipes(src));
		},
	},
});

// La serialización de tablas escapa todo `|` de la celda (\|), y eso rompería un
// [[slug|alias]]. Se protegen los pipes de los links antes de serializar y se
// devuelven después, para que el link salga byte a byte como entró.
type JsonNode = {
	type?: string;
	attrs?: Record<string, unknown>;
	content?: JsonNode[];
};

function protectLinksInJson(node: JsonNode): JsonNode {
	if (node.type === "wikiLink") {
		const attrs = node.attrs ?? {};
		const raw = typeof attrs.raw === "string" ? attrs.raw : null;
		return raw
			? { ...node, attrs: { ...attrs, raw: protectWikilinkPipes(raw) } }
			: node;
	}
	return node.content
		? { ...node, content: node.content.map(protectLinksInJson) }
		: node;
}

const BrainTable = Table.extend({
	renderMarkdown: (node, helpers) =>
		unprotectWikilinkPipes(
			renderTableToMarkdown(protectLinksInJson(node), helpers),
		),
});

export function buildExtensions(lookups: EditorLookups): Extensions {
	return [
		StarterKit.configure({
			heading: { levels: [1, 2, 3] },
			link: { openOnClick: false, autolink: false },
		}),
		Image.configure({ inline: true }),
		BrainTable.configure({ resizable: false }),
		TableRow,
		TableHeader,
		TableCell,
		TaskList,
		TaskItem.configure({ nested: true }),
		WikiLink.configure(lookups),
		RawHtml,
		Markdown.configure({ marked: brainMarked as unknown as typeof marked }),
	];
}
