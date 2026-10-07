"use client";

import { MenuIcon } from "lucide-react";
import { type ReactNode, useState } from "react";
import { BrainTree } from "@/components/brain/brain-tree";
import { Button } from "@/components/ui/button";
import {
	Sheet,
	SheetContent,
	SheetHeader,
	SheetTitle,
	SheetTrigger,
} from "@/components/ui/sheet";
import type { TreeNode } from "@/lib/brain/core/access/tree";

export function BrainShell({
	tenantSlug,
	root,
	canCreate,
	children,
}: {
	tenantSlug: string;
	root: TreeNode;
	canCreate: boolean;
	children: ReactNode;
}) {
	const [open, setOpen] = useState(false);
	const tree = (
		<BrainTree tenantSlug={tenantSlug} root={root} canCreate={canCreate} />
	);
	return (
		<div className="lg:grid lg:grid-cols-[260px_minmax(0,1fr)] lg:gap-8">
			<aside className="hidden lg:block">{tree}</aside>
			<div className="min-w-0">
				<div className="mb-4 lg:hidden">
					<Sheet open={open} onOpenChange={setOpen}>
						<SheetTrigger asChild>
							<Button variant="outline" className="min-h-11">
								<MenuIcon aria-hidden /> Archivos
							</Button>
						</SheetTrigger>
						<SheetContent
							side="left"
							className="w-[85vw] max-w-sm overflow-y-auto p-4"
						>
							<SheetHeader className="p-0">
								<SheetTitle>Archivos</SheetTitle>
							</SheetHeader>
							{tree}
						</SheetContent>
					</Sheet>
				</div>
				{children}
			</div>
		</div>
	);
}
