"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { updateDefaultModel } from "./actions";

export function ModeloForm({
	tenantId,
	slug,
	defaultModel,
	allowedModels,
}: {
	tenantId: string;
	slug: string;
	defaultModel: string;
	allowedModels: string[];
}) {
	const [model, setModel] = useState(defaultModel);
	const [message, setMessage] = useState<string | null>(null);
	const [isPending, startTransition] = useTransition();

	return (
		<form
			className="flex flex-wrap items-center gap-3"
			onSubmit={(event) => {
				event.preventDefault();
				startTransition(async () => {
					const result = await updateDefaultModel(tenantId, model, slug);
					setMessage(result.ok ? null : result.message);
				});
			}}
		>
			<select
				className="h-11 rounded-md border bg-background px-3 text-sm"
				value={model}
				disabled={isPending}
				onChange={(event) => setModel(event.target.value)}
			>
				{allowedModels.map((m) => (
					<option key={m} value={m}>
						{m}
					</option>
				))}
			</select>
			<Button
				type="submit"
				size="lg"
				disabled={isPending || model === defaultModel}
			>
				Guardar
			</Button>
			{message ? <p className="text-destructive text-sm">{message}</p> : null}
		</form>
	);
}
