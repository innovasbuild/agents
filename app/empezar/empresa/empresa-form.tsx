"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { createCompany } from "./actions";

export function EmpresaForm({ defaultDomain }: { defaultDomain: string }) {
	const [error, setError] = useState<string | null>(null);
	const [nameError, setNameError] = useState<string | null>(null);
	const [pending, startTransition] = useTransition();

	function onSubmit(event: React.FormEvent<HTMLFormElement>) {
		event.preventDefault();
		const formData = new FormData(event.currentTarget);
		const name = formData.get("display_name");
		if (typeof name !== "string" || !name.trim()) {
			setNameError("Escribí el nombre de tu empresa.");
			return;
		}
		setNameError(null);
		setError(null);
		startTransition(async () => {
			// En éxito la acción redirige y no devuelve nada.
			const result = await createCompany(formData);
			if (result && !result.ok) setError(result.message);
		});
	}

	return (
		<form className="space-y-5" noValidate onSubmit={onSubmit}>
			<div className="space-y-2">
				<label className="block text-sm" htmlFor="display_name">
					Nombre de la empresa
				</label>
				<Input
					aria-invalid={nameError ? true : undefined}
					autoComplete="organization"
					id="display_name"
					maxLength={80}
					name="display_name"
				/>
				{nameError ? (
					<p className="text-destructive text-sm" role="alert">
						{nameError}
					</p>
				) : null}
			</div>
			<div className="space-y-2">
				<label className="block text-sm" htmlFor="domain">
					Dominio principal
				</label>
				<Input
					defaultValue={defaultDomain}
					id="domain"
					name="domain"
					placeholder="tuempresa.com"
				/>
				<p className="text-muted-foreground text-xs">
					Lo tomamos de tu correo. Define quién puede entrar y qué investigamos
					para armar tu brain.
				</p>
			</div>
			{error ? (
				<p className="text-destructive text-sm" role="alert">
					{error}
				</p>
			) : null}
			<Button className="w-full" disabled={pending} size="lg" type="submit">
				Crear mi empresa
			</Button>
		</form>
	);
}
