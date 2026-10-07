import type { ReactNode } from "react";
import { BrainShell } from "@/components/brain/brain-shell";
import { loadBrainTree, loadEditorContext } from "@/lib/brain/adapters/editor";
import { editableFolders } from "@/lib/brain/core/access/tree";

export default async function BrainLayout({
	children,
	params,
}: {
	children: ReactNode;
	params: Promise<{ tenant: string }>;
}) {
	const { tenant } = await params;
	const ctx = await loadEditorContext(tenant);
	// Sin brain propio (o externo) cada pantalla muestra su aviso; no hay árbol.
	if (!ctx || ctx.kind !== "ok") return children;
	const root = await loadBrainTree(ctx);
	return (
		<BrainShell
			tenantSlug={tenant}
			root={root}
			canCreate={editableFolders(root).length > 0}
		>
			{children}
		</BrainShell>
	);
}
