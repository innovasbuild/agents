"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import type { AuthMethod } from "@/lib/tenants/auth-methods";
import { saveAccessStep } from "./actions";

const OPTIONS: { value: AuthMethod; label: string }[] = [
	{ value: "microsoft", label: "Microsoft" },
	{ value: "google", label: "Google" },
	{ value: "email", label: "Correo con código" },
];

export function AccesoForm({
	slug,
	domain,
	initialMethods,
}: {
	slug: string;
	domain: string;
	initialMethods: AuthMethod[];
}) {
	const [methods, setMethods] = useState<AuthMethod[]>(initialMethods);
	const [restrictToDomain, setRestrictToDomain] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [pending, startTransition] = useTransition();

	function toggle(value: AuthMethod, checked: boolean) {
		setMethods((current) =>
			checked ? [...current, value] : current.filter((m) => m !== value),
		);
	}

	function submit(e: React.FormEvent) {
		e.preventDefault();
		if (methods.length === 0) {
			setError("Dejá al menos una forma de entrar.");
			return;
		}
		setError(null);
		startTransition(async () => {
			const result = await saveAccessStep(slug, { methods, restrictToDomain });
			if (!result.ok) setError(result.message);
		});
	}

	return (
		<form className="space-y-5" noValidate onSubmit={submit}>
			<div className="space-y-2">
				<h1 className="text-2xl leading-tight">Cómo entra tu equipo</h1>
				<p className="text-muted-foreground text-sm">
					Elegí con qué cuentas pueden entrar. Lo cambiás después desde
					Configuración.
				</p>
			</div>
			<fieldset className="space-y-3">
				<legend className="mb-2 font-medium text-sm">Formas de entrar</legend>
				{OPTIONS.map((o) => (
					<label className="flex items-center gap-2 text-sm" key={o.value}>
						<input
							checked={methods.includes(o.value)}
							onChange={(e) => toggle(o.value, e.target.checked)}
							type="checkbox"
						/>
						{o.label}
					</label>
				))}
				{error ? (
					<p className="text-destructive text-sm" role="alert">
						{error}
					</p>
				) : null}
			</fieldset>
			<div className="space-y-1">
				<label className="flex items-center gap-2 text-sm">
					<input
						checked={restrictToDomain}
						onChange={(e) => setRestrictToDomain(e.target.checked)}
						type="checkbox"
					/>
					Solo correos @{domain}
				</label>
				<p className="pl-6 text-muted-foreground text-xs">
					Para invitar a alguien de afuera vas a tener que marcarlo a propósito.
				</p>
			</div>
			<fieldset className="space-y-3">
				<legend className="mb-2 font-medium text-sm">
					Quién puede sumarse
				</legend>
				<label className="flex items-start gap-2 text-sm">
					<input checked className="mt-1" name="join" readOnly type="radio" />
					<span>
						Solo por invitación
						<span className="block text-muted-foreground text-xs">
							Vos decidís quién entra, uno por uno.
						</span>
					</span>
				</label>
				<label className="flex items-start gap-2 text-muted-foreground text-sm">
					<input className="mt-1" disabled name="join" type="radio" />
					<span>
						Todos los del dominio{" "}
						<span className="rounded-full border px-2 py-0.5 text-xs">
							Disponible pronto
						</span>
						<span className="block text-xs">
							Cualquiera con correo @{domain} pide acceso y vos lo aprobás.
						</span>
					</span>
				</label>
			</fieldset>
			<Button className="w-full" disabled={pending} size="lg" type="submit">
				Guardar y seguir
			</Button>
		</form>
	);
}
