"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { saveAiMonthlyLimit } from "../perfil-actions";

export function AiLimitForm({
	slug,
	initial,
}: {
	slug: string;
	/** Tope actual en USD, o null si no hay. */
	initial: number | null;
}) {
	const [value, setValue] = useState(initial === null ? "" : String(initial));
	const [message, setMessage] = useState<string | null>(null);
	const [saved, setSaved] = useState(false);
	const [pending, startTransition] = useTransition();

	function submit(event: React.FormEvent) {
		event.preventDefault();
		const text = value.trim().replace(",", ".");
		const limit = text === "" ? null : Number(text);
		if (limit !== null && (!Number.isFinite(limit) || limit < 0)) {
			setSaved(false);
			setMessage("Poné un monto en dólares, por ejemplo 50.");
			return;
		}
		setMessage(null);
		startTransition(async () => {
			const result = await saveAiMonthlyLimit(slug, limit);
			setSaved(result.ok);
			setMessage(result.ok ? null : result.message);
		});
	}

	return (
		<form className="space-y-3" noValidate onSubmit={submit}>
			<label className="block space-y-1 text-sm" htmlFor="ai-limit">
				<span className="font-medium">Tope mensual de IA (USD)</span>
				<input
					className="block min-h-11 w-40 rounded-md border bg-background px-3 tabular-nums"
					disabled={pending}
					id="ai-limit"
					inputMode="decimal"
					onChange={(event) => {
						setValue(event.target.value);
						setSaved(false);
					}}
					placeholder="Sin tope"
					value={value}
				/>
			</label>
			<p className="text-muted-foreground text-xs">
				Si lo dejás vacío, no hay tope. Al llegar, el chat espera hasta el mes
				que viene.
			</p>
			<Button disabled={pending} size="lg" type="submit">
				Guardar
			</Button>
			{message ? (
				<p className="text-destructive text-sm" role="alert">
					{message}
				</p>
			) : null}
			{saved ? <p className="text-sm">Guardado.</p> : null}
		</form>
	);
}
