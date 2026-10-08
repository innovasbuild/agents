"use client";

import { useState } from "react";
import { DeletePageDialog } from "@/components/brain/delete-page-dialog";
import { Button } from "@/components/ui/button";

export function DeletePageButton({
	tenantSlug,
	slug,
	title,
}: {
	tenantSlug: string;
	slug: string;
	title: string;
}) {
	const [open, setOpen] = useState(false);
	return (
		<>
			<Button
				type="button"
				variant="outline"
				className="min-h-11 text-destructive"
				onClick={() => setOpen(true)}
			>
				Borrar página
			</Button>
			{open && (
				<DeletePageDialog
					tenantSlug={tenantSlug}
					slug={slug}
					title={title}
					onClose={() => setOpen(false)}
				/>
			)}
		</>
	);
}
