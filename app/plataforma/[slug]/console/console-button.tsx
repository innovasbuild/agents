// app/plataforma/[slug]/console/console-button.tsx
"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import type { Feedback } from "@/app/[tenant]/settings/usuarios/run-row-action";
import { runRowAction } from "@/app/[tenant]/settings/usuarios/run-row-action";
import { Button } from "@/components/ui/button";
import type { ConsoleResult } from "../console-actions";

export function ConsoleMessage({ feedback }: { feedback: Feedback }) {
	if (!feedback) return null;
	return (
		<span
			className={
				feedback.ok
					? "text-muted-foreground text-xs"
					: "text-destructive text-xs"
			}
			role={feedback.ok ? "status" : "alert"}
		>
			{feedback.text}
		</span>
	);
}

/** Botón que corre una acción de consola ya ligada a su fila y muestra lo que respondió. */
export function ConsoleButton({
	run,
	label,
	confirmText,
	variant = "outline",
}: {
	run: () => Promise<ConsoleResult>;
	label: string;
	confirmText?: string;
	variant?: "outline" | "default";
}) {
	const router = useRouter();
	const [pending, startTransition] = useTransition();
	const [feedback, setFeedback] = useState<Feedback>(null);

	function onClick() {
		setFeedback(null);
		startTransition(async () => {
			const out = await runRowAction({
				run,
				confirmText,
				confirm: (text) => window.confirm(text),
				refresh: () => router.refresh(),
			});
			if (out.ran) setFeedback(out.feedback);
		});
	}

	return (
		<span className="inline-flex flex-wrap items-center gap-2">
			<ConsoleMessage feedback={feedback} />
			<Button
				disabled={pending}
				onClick={onClick}
				size="sm"
				type="button"
				variant={variant}
			>
				{label}
			</Button>
		</span>
	);
}
