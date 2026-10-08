"use client";

import type { Editor } from "@tiptap/react";
import {
	Bold,
	Code,
	FileCode,
	Heading1,
	Heading2,
	Heading3,
	Italic,
	Link2,
	Link as LinkIcon,
	List,
	ListChecks,
	ListOrdered,
	Minus,
	Quote,
	Redo2,
	Strikethrough,
	Table as TableIcon,
	Undo2,
} from "lucide-react";
import { type ReactNode, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

// Barra de herramientas del editor (spec 18.2 §4). Se desplaza en horizontal
// dentro de sí misma: a 375 px no mueve la página. Si algún ícono no existe en
// la versión instalada de lucide-react, usar el más parecido.
function Tool({
	label,
	active,
	disabled,
	onClick,
	children,
}: {
	label: string;
	active?: boolean;
	disabled?: boolean;
	onClick: () => void;
	children: ReactNode;
}) {
	return (
		<Button
			type="button"
			variant={active ? "secondary" : "ghost"}
			size="icon"
			aria-label={label}
			title={label}
			aria-pressed={active}
			disabled={disabled}
			onMouseDown={(event) => event.preventDefault()}
			onClick={onClick}
			className="size-11 shrink-0 lg:size-8"
		>
			{children}
		</Button>
	);
}

function Separator() {
	return <span aria-hidden className="mx-1 h-6 w-px shrink-0 bg-border" />;
}

export function Toolbar({
	editor,
	onWikiLink,
	onToggleSource,
	source,
}: {
	editor: Editor | null;
	onWikiLink: () => void;
	onToggleSource: () => void;
	source: boolean;
}) {
	const [linkOpen, setLinkOpen] = useState(false);
	const [url, setUrl] = useState("");

	if (!editor) return <div className="h-11 lg:h-10" />;
	const off = source;
	const can = editor.can();
	const inTable = editor.isActive("table");

	function applyLink() {
		const href = url.trim();
		if (!editor) return;
		if (href)
			editor.chain().focus().extendMarkRange("link").setLink({ href }).run();
		else editor.chain().focus().extendMarkRange("link").unsetLink().run();
		setLinkOpen(false);
		setUrl("");
	}

	return (
		<div
			role="toolbar"
			aria-label="Formato"
			className="flex flex-wrap items-center gap-1 rounded-md border bg-background p-1 lg:flex-nowrap"
		>
			<div className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto">
				<Tool
					label="Deshacer"
					disabled={off || !can.undo()}
					onClick={() => editor.chain().focus().undo().run()}
				>
					<Undo2 />
				</Tool>
				<Tool
					label="Rehacer"
					disabled={off || !can.redo()}
					onClick={() => editor.chain().focus().redo().run()}
				>
					<Redo2 />
				</Tool>
				<Separator />
				<Tool
					label="Título 1"
					disabled={off}
					active={editor.isActive("heading", { level: 1 })}
					onClick={() =>
						editor.chain().focus().toggleHeading({ level: 1 }).run()
					}
				>
					<Heading1 />
				</Tool>
				<Tool
					label="Título 2"
					disabled={off}
					active={editor.isActive("heading", { level: 2 })}
					onClick={() =>
						editor.chain().focus().toggleHeading({ level: 2 }).run()
					}
				>
					<Heading2 />
				</Tool>
				<Tool
					label="Título 3"
					disabled={off}
					active={editor.isActive("heading", { level: 3 })}
					onClick={() =>
						editor.chain().focus().toggleHeading({ level: 3 }).run()
					}
				>
					<Heading3 />
				</Tool>
				<Separator />
				<Tool
					label="Negrita"
					disabled={off}
					active={editor.isActive("bold")}
					onClick={() => editor.chain().focus().toggleBold().run()}
				>
					<Bold />
				</Tool>
				<Tool
					label="Cursiva"
					disabled={off}
					active={editor.isActive("italic")}
					onClick={() => editor.chain().focus().toggleItalic().run()}
				>
					<Italic />
				</Tool>
				<Tool
					label="Tachado"
					disabled={off}
					active={editor.isActive("strike")}
					onClick={() => editor.chain().focus().toggleStrike().run()}
				>
					<Strikethrough />
				</Tool>
				<Tool
					label="Código en línea"
					disabled={off}
					active={editor.isActive("code")}
					onClick={() => editor.chain().focus().toggleCode().run()}
				>
					<Code />
				</Tool>
				<Separator />
				<Tool
					label="Lista con viñetas"
					disabled={off}
					active={editor.isActive("bulletList")}
					onClick={() => editor.chain().focus().toggleBulletList().run()}
				>
					<List />
				</Tool>
				<Tool
					label="Lista numerada"
					disabled={off}
					active={editor.isActive("orderedList")}
					onClick={() => editor.chain().focus().toggleOrderedList().run()}
				>
					<ListOrdered />
				</Tool>
				<Tool
					label="Lista de tareas"
					disabled={off}
					active={editor.isActive("taskList")}
					onClick={() => editor.chain().focus().toggleTaskList().run()}
				>
					<ListChecks />
				</Tool>
				<Tool
					label="Cita"
					disabled={off}
					active={editor.isActive("blockquote")}
					onClick={() => editor.chain().focus().toggleBlockquote().run()}
				>
					<Quote />
				</Tool>
				<Tool
					label="Bloque de código"
					disabled={off}
					active={editor.isActive("codeBlock")}
					onClick={() => editor.chain().focus().toggleCodeBlock().run()}
				>
					<FileCode />
				</Tool>
				<Tool
					label="Línea divisoria"
					disabled={off}
					onClick={() => editor.chain().focus().setHorizontalRule().run()}
				>
					<Minus />
				</Tool>
				<Separator />
				<Tool
					label="Tabla"
					disabled={off}
					active={inTable}
					onClick={() =>
						editor
							.chain()
							.focus()
							.insertTable({ rows: 3, cols: 3, withHeaderRow: true })
							.run()
					}
				>
					<TableIcon />
				</Tool>
				<Tool
					label="Link"
					disabled={off}
					active={editor.isActive("link")}
					onClick={() => {
						setUrl(editor.getAttributes("link").href ?? "");
						setLinkOpen((v) => !v);
					}}
				>
					<LinkIcon />
				</Tool>
				<Tool
					label="Link a página del brain"
					disabled={off}
					onClick={onWikiLink}
				>
					<Link2 />
				</Tool>
			</div>
			<Button
				type="button"
				variant={source ? "secondary" : "outline"}
				aria-pressed={source}
				onClick={onToggleSource}
				className="min-h-11 shrink-0 lg:min-h-8"
			>
				Markdown
			</Button>
			{inTable && !off && (
				<div className="flex w-full flex-wrap gap-1 border-t pt-1">
					<Button
						type="button"
						variant="ghost"
						size="sm"
						onMouseDown={(e) => e.preventDefault()}
						onClick={() => editor.chain().focus().addColumnAfter().run()}
					>
						+ Columna
					</Button>
					<Button
						type="button"
						variant="ghost"
						size="sm"
						onMouseDown={(e) => e.preventDefault()}
						onClick={() => editor.chain().focus().deleteColumn().run()}
					>
						− Columna
					</Button>
					<Button
						type="button"
						variant="ghost"
						size="sm"
						onMouseDown={(e) => e.preventDefault()}
						onClick={() => editor.chain().focus().addRowAfter().run()}
					>
						+ Fila
					</Button>
					<Button
						type="button"
						variant="ghost"
						size="sm"
						onMouseDown={(e) => e.preventDefault()}
						onClick={() => editor.chain().focus().deleteRow().run()}
					>
						− Fila
					</Button>
					<Button
						type="button"
						variant="ghost"
						size="sm"
						onMouseDown={(e) => e.preventDefault()}
						onClick={() => editor.chain().focus().deleteTable().run()}
					>
						Borrar tabla
					</Button>
				</div>
			)}
			{linkOpen && !off && (
				<div className="flex w-full items-center gap-2 border-t pt-1">
					<Input
						value={url}
						onChange={(e) => setUrl(e.target.value)}
						placeholder="https://… (vacío para quitar el link)"
						aria-label="Dirección del link"
						className="min-h-11 lg:min-h-8"
						onKeyDown={(e) => {
							if (e.key === "Enter") {
								e.preventDefault();
								applyLink();
							}
							if (e.key === "Escape") setLinkOpen(false);
						}}
					/>
					<Button
						type="button"
						className="min-h-11 lg:min-h-8"
						onClick={applyLink}
					>
						Aplicar
					</Button>
				</div>
			)}
		</div>
	);
}
