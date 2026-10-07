"use client";

import { ChevronRightIcon } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { ShareDialog } from "@/components/brain/share-dialog";
import { TreeRowMenu } from "@/components/brain/tree-row-menu";
import { type TreeNode, withoutArchived } from "@/lib/brain/core/access/tree";
import { pageHref } from "@/lib/brain/core/editor/slug";

// El plegado vive en localStorage por tenant (§7.1). Puede fallar (ventana
// privada, datos bloqueados): se envuelve y la pantalla anda igual.
type OpenState = Record<string, boolean>;

function readOpen(key: string): OpenState | null {
	try {
		const raw = localStorage.getItem(key);
		const parsed = raw ? JSON.parse(raw) : null;
		if (Array.isArray(parsed)) {
			return Object.fromEntries(parsed.map((p) => [String(p), true]));
		}
		return parsed && typeof parsed === "object" ? (parsed as OpenState) : null;
	} catch {
		return null;
	}
}
function writeOpen(key: string, open: OpenState) {
	try {
		localStorage.setItem(key, JSON.stringify(open));
	} catch {
		// sin almacenamiento: el plegado dura lo que dure la pantalla
	}
}

export function BrainTree({
	tenantSlug,
	root,
	canCreate,
}: {
	tenantSlug: string;
	root: TreeNode;
	canCreate: boolean;
}) {
	const pathname = usePathname();
	const storageKey = `brain-tree:${tenantSlug}`;
	const [open, setOpen] = useState<OpenState>({});
	const [showArchived, setShowArchived] = useState(false);
	const [sharing, setSharing] = useState<{ path: string; name: string } | null>(
		null,
	);
	useEffect(() => {
		const saved = readOpen(storageKey);
		if (saved) setOpen(saved);
	}, [storageKey]);

	const tree = useMemo(
		() => (showArchived ? root : withoutArchived(root)),
		[root, showArchived],
	);
	const prefix = `/${tenantSlug}/brain/p/`;
	const currentSlug = pathname.startsWith(prefix)
		? pathname.slice(prefix.length)
		: null;

	// Lo que la persona decidió a mano gana; la ascendencia de la página actual
	// solo abre por defecto.
	const isFolderOpen = (path: string) =>
		(Object.hasOwn(open, path) ? open[path] : undefined) ??
		(currentSlug !== null && currentSlug.startsWith(`${path}/`));

	const toggle = (path: string) => {
		const next = { ...open, [path]: !isFolderOpen(path) };
		setOpen(next);
		writeOpen(storageKey, next);
	};

	const renderNode = (node: TreeNode, depth: number) => {
		const hasChildren = node.children.length > 0;
		// La carpeta de la página actual se muestra abierta aunque no se haya plegado a mano.
		const isOpen = isFolderOpen(node.path);
		const label = node.page?.title ?? node.name;
		const isCurrent = node.page !== null && node.page.slug === currentSlug;
		return (
			<li key={node.path}>
				<div
					className={`group flex min-h-11 items-center rounded-md lg:min-h-8 ${isCurrent ? "bg-muted font-medium" : "hover:bg-muted/50"} ${node.page?.status === "archivado" ? "opacity-60" : ""}`}
					style={{ paddingLeft: depth * 12 }}
				>
					{hasChildren ? (
						<button
							type="button"
							aria-label={isOpen ? "Plegar" : "Desplegar"}
							aria-expanded={isOpen}
							onClick={() => toggle(node.path)}
							className="inline-flex size-11 shrink-0 items-center justify-center lg:size-7"
						>
							<ChevronRightIcon
								aria-hidden
								className={`size-4 transition-transform ${isOpen ? "rotate-90" : ""}`}
							/>
						</button>
					) : (
						<span className="size-11 shrink-0 lg:size-7" aria-hidden />
					)}
					{node.page ? (
						<Link
							href={pageHref(tenantSlug, node.page.slug)}
							title={node.page.slug}
							className="min-w-0 flex-1 truncate text-sm"
						>
							{label}
						</Link>
					) : (
						<button
							type="button"
							onClick={() => toggle(node.path)}
							className="min-w-0 flex-1 truncate text-left text-sm"
						>
							{label}
						</button>
					)}
					<TreeRowMenu
						tenantSlug={tenantSlug}
						node={node}
						onShare={() => setSharing({ path: node.path, name: label })}
					/>
				</div>
				{hasChildren && isOpen && (
					<ul>{node.children.map((child) => renderNode(child, depth + 1))}</ul>
				)}
			</li>
		);
	};

	return (
		<nav aria-label="Archivos del brain" className="space-y-2 text-sm">
			<div className="group flex items-center gap-2">
				<Link
					href={`/${tenantSlug}/brain`}
					className="min-w-0 flex-1 truncate font-medium"
				>
					Brain
				</Link>
				<TreeRowMenu
					tenantSlug={tenantSlug}
					node={root}
					label="Brain"
					onShare={() => setSharing({ path: "", name: "Brain" })}
				/>
			</div>
			{canCreate && (
				<Link
					href={`/${tenantSlug}/brain/nueva`}
					className="inline-flex min-h-11 w-full items-center justify-center rounded-md border text-sm hover:bg-muted lg:min-h-8"
				>
					Nueva página
				</Link>
			)}
			{tree.children.length === 0 ? (
				<p className="text-muted-foreground">No hay páginas para mostrar.</p>
			) : (
				<ul>{tree.children.map((node) => renderNode(node, 0))}</ul>
			)}
			<label className="flex min-h-11 items-center gap-2 text-muted-foreground lg:min-h-8">
				<input
					type="checkbox"
					checked={showArchived}
					onChange={(e) => setShowArchived(e.target.checked)}
				/>
				Mostrar archivadas
			</label>
			{sharing && (
				<ShareDialog
					tenantSlug={tenantSlug}
					path={sharing.path}
					name={sharing.name}
					onClose={() => setSharing(null)}
				/>
			)}
		</nav>
	);
}
