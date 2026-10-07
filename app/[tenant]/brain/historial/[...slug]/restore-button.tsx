"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import type { SavePageInput } from "@/lib/brain/core/editor/save";
import { saveBrainPage } from "../../actions";

export function RestoreButton({ input }: { input: SavePageInput }) {
	const router = useRouter();
	const [message, setMessage] = useState<string | null>(null);
	const [isPending, startTransition] = useTransition();
	return (
		<div className="flex flex-wrap items-center gap-3">
			<Button
				variant="outline"
				disabled={isPending}
				onClick={() =>
					startTransition(async () => {
						const result = await saveBrainPage(input);
						if (result.ok) router.refresh();
						else setMessage(result.message);
					})
				}
			>
				{isPending ? "Restaurando…" : "Restaurar esta revisión"}
			</Button>
			{message && (
				<span role="alert" className="text-destructive text-sm">
					{message}
				</span>
			)}
		</div>
	);
}
