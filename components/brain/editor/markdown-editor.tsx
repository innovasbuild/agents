"use client";

import type { EditorProps } from "@tiptap/pm/view";
import { EditorContent, useEditor } from "@tiptap/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Textarea } from "@/components/ui/textarea";
import {
	sanitizeAlias,
	wikilinkQueryAt,
} from "@/lib/brain/core/editor/autocomplete";
import { pageHref } from "@/lib/brain/core/editor/slug";
import type { BrainStatus } from "@/lib/brain/core/types";
import { buildExtensions } from "./extensions";
import { Toolbar } from "./toolbar";

const MAX_SUGGESTIONS = 8;

interface PageRef {
	slug: string;
	title: string;
	status: BrainStatus;
}

export interface MarkdownEditorProps {
	tenantSlug: string;
	// Markdown con el que se carga el editor visual.
	initialMarkdown: string;
	// Cuerpo vigente que decide el espacio de trabajo: es lo que muestra la vista de código.
	value: string;
	pages: PageRef[];
	disabled?: boolean;
	invalid?: boolean;
	// La serialización del contenido tal como cargó (una vez, al crearse el editor).
	onBaseline: (markdown: string) => void;
	// La serialización (visual) o el texto (código) después de cada cambio.
	onChange: (markdown: string) => void;
}

export function MarkdownEditor({
	tenantSlug,
	initialMarkdown,
	value,
	pages,
	disabled,
	invalid,
	onBaseline,
	onChange,
}: MarkdownEditorProps) {
	const [source, setSource] = useState(false);
	const [query, setQuery] = useState<{
		query: string;
		from: number;
		to: number;
		// Con texto seleccionado: lo seleccionado pasa a ser el alias del link.
		alias?: string;
	} | null>(null);
	const titles = useMemo(
		() => new Map(pages.map((p) => [p.slug, p.title])),
		[pages],
	);
	const extensions = useMemo(
		() =>
			buildExtensions({
				titleFor: (slug) => titles.get(slug),
				exists: (slug) => titles.has(slug),
			}),
		[titles],
	);
	const onChangeRef = useRef(onChange);
	onChangeRef.current = onChange;

	const detectQuery = useCallback(
		(ed: NonNullable<ReturnType<typeof useEditor>>) => {
			const { $from, empty } = ed.state.selection;
			if (!empty || !$from.parent.isTextblock) return setQuery(null);
			const before = $from.parent.textBetween(
				0,
				$from.parentOffset,
				undefined,
				"￼",
			);
			const found = wikilinkQueryAt(before, before.length);
			if (!found) return setQuery(null);
			setQuery({
				query: found.query,
				from: $from.pos - (before.length - found.start),
				to: $from.pos,
			});
		},
		[],
	);

	const editorProps = useMemo<EditorProps>(
		() => ({
			attributes: {
				class: "brain-prose min-h-[40vh] focus:outline-none",
				"aria-label": "Contenido de la página",
				...(invalid ? { "aria-invalid": "true" } : {}),
			},
			// Cmd/Ctrl + clic en un link del brain lo abre en otra pestaña.
			handleClickOn: (_view, _pos, node, _nodePos, event) => {
				if (node.type.name === "wikiLink" && (event.metaKey || event.ctrlKey)) {
					window.open(
						pageHref(tenantSlug, String(node.attrs.target)),
						"_blank",
						"noopener",
					);
					return true;
				}
				return false;
			},
		}),
		[tenantSlug, invalid],
	);

	const editor = useEditor({
		extensions,
		content: initialMarkdown,
		contentType: "markdown",
		immediatelyRender: false,
		editable: !disabled,
		editorProps,
		shouldRerenderOnTransaction: true,
		onCreate: ({ editor: ed }) => onBaseline(ed.getMarkdown()),
		onUpdate: ({ editor: ed }) => {
			onChangeRef.current(ed.getMarkdown());
			detectQuery(ed);
		},
		onSelectionUpdate: ({ editor: ed }) => detectQuery(ed),
	});

	useEffect(() => {
		editor?.setEditable(!disabled);
	}, [editor, disabled]);

	const matches = query
		? pages.filter((p) =>
				`${p.slug} ${p.title}`
					.toLowerCase()
					.includes(query.query.toLowerCase()),
			)
		: [];
	// Con texto seleccionado, si el filtro no encuentra nada se muestran las primeras.
	const suggestions = (
		query && matches.length === 0 && query.alias !== undefined ? pages : matches
	).slice(0, MAX_SUGGESTIONS);

	function insertWiki(target: string) {
		if (!editor || disabled) return;
		const range = query ?? undefined;
		const chain = editor.chain().focus();
		if (range) chain.deleteRange({ from: range.from, to: range.to });
		chain
			.insertContent({
				type: "wikiLink",
				attrs: {
					target,
					anchor: null,
					alias: range?.alias ? sanitizeAlias(range.alias) || null : null,
					raw: null,
				},
			})
			.run();
		setQuery(null);
	}

	function toggleSource() {
		if (!editor || disabled) return;
		setQuery(null);
		if (!source) {
			setSource(true);
			return;
		}
		// De código a visual: se vuelve a leer lo que se escribió.
		editor.commands.setContent(value, {
			contentType: "markdown",
			emitUpdate: false,
		});
		setSource(false);
		// Sin cambios respecto del original: la línea de base pasa a lo que el
		// editor serializa ahora, para no quedar sucio sin que nadie escriba.
		if (value === initialMarkdown) onBaseline(editor.getMarkdown());
		else onChangeRef.current(editor.getMarkdown());
	}

	function linkToPage() {
		if (!editor) return;
		const { from, to, empty } = editor.state.selection;
		if (empty) {
			editor.chain().focus().insertContent("[[").run();
			return;
		}
		const selected = sanitizeAlias(editor.state.doc.textBetween(from, to, " "));
		setQuery({ query: selected, from, to, alias: selected });
	}

	return (
		<div className="space-y-3">
			<div className="sticky top-28 z-10">
				<Toolbar
					editor={editor}
					source={source}
					disabled={disabled}
					onToggleSource={toggleSource}
					onWikiLink={linkToPage}
				/>
			</div>
			<div className="relative">
				{source ? (
					<Textarea
						value={value}
						rows={24}
						className="font-mono text-sm"
						aria-label="Markdown de la página"
						aria-invalid={invalid}
						disabled={disabled}
						onChange={(event) => onChange(event.target.value)}
					/>
				) : (
					<EditorContent editor={editor} />
				)}
				{!source && !disabled && suggestions.length > 0 && (
					<ul className="absolute right-0 bottom-0 left-0 z-10 max-h-60 overflow-auto rounded-md border bg-popover text-popover-foreground text-sm shadow-md">
						{suggestions.map((p) => (
							<li key={p.slug}>
								<button
									type="button"
									className="flex min-h-11 w-full flex-col items-start justify-center px-3 py-2 text-left hover:bg-muted"
									onMouseDown={(event) => event.preventDefault()}
									onClick={() => insertWiki(p.slug)}
								>
									<span>{p.title}</span>
									<span className="text-muted-foreground text-xs">
										{p.slug}
									</span>
								</button>
							</li>
						))}
					</ul>
				)}
			</div>
		</div>
	);
}
