"use client";

import { MoreHorizontalIcon } from "lucide-react";
import Link from "next/link";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { isFolderNode, type TreeNode } from "@/lib/brain/core/access/tree";
import { atLeast, type Level } from "@/lib/brain/core/access/types";
import {
	isSkillsFolder,
	rulesEntryHref,
} from "@/lib/brain/core/editor/reserved";
import { historyHref } from "@/lib/brain/core/editor/slug";

export type FolderMenuItem =
	| "new-subfolder"
	| "describe"
	| "rules"
	| "delete-folder"
	| "delete-folder-blocked";

// Acciones de carpeta: solo para quien administra. Una carpeta implícita (sin
// fila en brain_folders) no ofrece ninguna: la base pide la fila del padre para
// crear adentro. Borrar una de primer nivel pide administrar la raíz; con
// contenido, el ítem queda deshabilitado con el motivo (spec etapa 26 §3.2).
// Las reglas (26.2): la raíz abre las instrucciones del brain; skills/ no tiene.
export function folderMenuItems(
	node: TreeNode,
	rootLevel: Level | null,
	deleteBlockedReason: string | null,
): FolderMenuItem[] {
	if (node.level !== "administrador" || !isFolderNode(node)) return [];
	if (node.path === "") return ["new-subfolder", "rules"];
	if (node.folder === null) return [];
	const items: FolderMenuItem[] = ["new-subfolder", "describe"];
	if (!isSkillsFolder(node.path)) items.push("rules");
	if (node.path.includes("/") || rootLevel === "administrador")
		items.push(
			deleteBlockedReason === null ? "delete-folder" : "delete-folder-blocked",
		);
	return items;
}

export function rulesMenuLabel(node: TreeNode): string {
	return node.path === "" ? "Instrucciones del brain" : "Reglas de la carpeta";
}

// Ítems según §7.2: lo que no corresponde no se muestra.
export function TreeRowMenu({
	tenantSlug,
	node,
	rootLevel,
	onShare,
	onDelete,
	onNewFolder,
	onDescribe,
	onDeleteFolder,
	deleteBlockedReason,
	label,
}: {
	tenantSlug: string;
	node: TreeNode;
	rootLevel: Level | null;
	onShare: () => void;
	onDelete: () => void;
	onNewFolder: () => void;
	onDescribe: () => void;
	onDeleteFolder: () => void;
	deleteBlockedReason: string | null;
	label?: string;
}) {
	const isFolder = isFolderNode(node);
	const canEdit = atLeast(node.level, "editor");
	const items: React.ReactNode[] = [];

	if (isFolder && canEdit) {
		items.push(
			<DropdownMenuItem asChild key="new" className="min-h-11 lg:min-h-0">
				<Link href={`/${tenantSlug}/brain/nueva?en=${node.path}`}>
					Nueva página acá
				</Link>
			</DropdownMenuItem>,
		);
	}
	if (node.page) {
		items.push(
			<DropdownMenuItem asChild key="history" className="min-h-11 lg:min-h-0">
				<Link href={historyHref(tenantSlug, node.page.slug)}>Historial</Link>
			</DropdownMenuItem>,
		);
	}
	if (node.level === "administrador") {
		items.push(
			<DropdownMenuItem
				key="share"
				className="min-h-11 lg:min-h-0"
				onSelect={onShare}
			>
				Compartir…
			</DropdownMenuItem>,
		);
	}
	if (node.page && node.level === "administrador") {
		items.push(
			<DropdownMenuItem
				key="delete"
				className="min-h-11 text-destructive focus:text-destructive lg:min-h-0"
				onSelect={onDelete}
			>
				Borrar…
			</DropdownMenuItem>,
		);
	}
	const folderItems = folderMenuItems(node, rootLevel, deleteBlockedReason);
	if (folderItems.includes("new-subfolder")) {
		items.push(
			<DropdownMenuItem
				key="new-folder"
				className="min-h-11 lg:min-h-0"
				onSelect={onNewFolder}
			>
				{node.path === "" ? "Nueva carpeta…" : "Nueva subcarpeta…"}
			</DropdownMenuItem>,
		);
	}
	if (folderItems.includes("describe")) {
		items.push(
			<DropdownMenuItem
				key="describe"
				className="min-h-11 lg:min-h-0"
				onSelect={onDescribe}
			>
				Editar descripción…
			</DropdownMenuItem>,
		);
	}
	if (folderItems.includes("rules")) {
		items.push(
			<DropdownMenuItem asChild key="rules" className="min-h-11 lg:min-h-0">
				<Link href={rulesEntryHref(tenantSlug, node)}>
					{rulesMenuLabel(node)}
				</Link>
			</DropdownMenuItem>,
		);
	}
	if (folderItems.includes("delete-folder")) {
		items.push(
			<DropdownMenuItem
				key="delete-folder"
				className="min-h-11 text-destructive focus:text-destructive lg:min-h-0"
				onSelect={onDeleteFolder}
			>
				Borrar carpeta…
			</DropdownMenuItem>,
		);
	}
	if (folderItems.includes("delete-folder-blocked")) {
		items.push(
			<DropdownMenuItem
				key="delete-folder"
				disabled
				className="min-h-11 flex-col items-start gap-0.5 lg:min-h-0"
			>
				<span>Borrar carpeta…</span>
				<span className="text-muted-foreground text-xs">
					{deleteBlockedReason}
				</span>
			</DropdownMenuItem>,
		);
	}
	if (items.length === 0) return null;

	return (
		// modal={false}: "Compartir…" abre un Dialog modal mientras el menú se
		// cierra; con el menú modal, ambos pelean por el bloqueo del <body> y
		// puede quedar pointer-events: none pegado.
		<DropdownMenu modal={false}>
			<DropdownMenuTrigger
				aria-label={`Opciones de ${label ?? node.page?.title ?? node.name}`}
				className="inline-flex size-11 shrink-0 items-center justify-center rounded-md text-muted-foreground opacity-100 hover:bg-muted lg:size-7 lg:opacity-0 lg:focus-visible:opacity-100 lg:group-hover:opacity-100 lg:group-focus-within:opacity-100 data-[state=open]:opacity-100"
			>
				<MoreHorizontalIcon aria-hidden className="size-4" />
			</DropdownMenuTrigger>
			<DropdownMenuContent align="end" className="min-w-44">
				{items}
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
