"use client";

import { MoreHorizontalIcon } from "lucide-react";
import Link from "next/link";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { TreeNode } from "@/lib/brain/core/access/tree";
import { atLeast } from "@/lib/brain/core/access/types";
import { editHref, historyHref } from "@/lib/brain/core/editor/slug";

// Ítems según §7.2: lo que no corresponde no se muestra.
export function TreeRowMenu({
	tenantSlug,
	node,
	onShare,
	label,
}: {
	tenantSlug: string;
	node: TreeNode;
	onShare: () => void;
	label?: string;
}) {
	const isFolder = node.children.length > 0;
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
	if (node.page && canEdit) {
		items.push(
			<DropdownMenuItem asChild key="edit" className="min-h-11 lg:min-h-0">
				<Link href={editHref(tenantSlug, node.page.slug)}>Editar</Link>
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
	if (items.length === 0) return null;

	return (
		<DropdownMenu>
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
