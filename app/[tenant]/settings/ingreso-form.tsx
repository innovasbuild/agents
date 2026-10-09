"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { domainsPhrase } from "@/lib/tenants/domains-phrase";
import { updateSignupMode } from "./actions";

export function IngresoForm({
	tenantId,
	slug,
	open,
	domains,
}: {
	tenantId: string;
	slug: string;
	open: boolean;
	domains: string[];
}) {
	const [value, setValue] = useState(open);
	const [message, setMessage] = useState<string | null>(null);
	const [isPending, startTransition] = useTransition();
	const sinDominios = domains.length === 0;

	return (
		<form
			className="space-y-3"
			onSubmit={(event) => {
				event.preventDefault();
				startTransition(async () => {
					const result = await updateSignupMode(tenantId, value, slug);
					setMessage(result.ok ? null : result.message);
				});
			}}
		>
			<label className="flex min-h-11 items-start gap-2 text-sm">
				<input
					type="radio"
					name="ingreso"
					className="mt-1"
					checked={!value}
					disabled={isPending}
					onChange={() => setValue(false)}
				/>
				<span>
					<strong>Solo por invitación.</strong> Entra únicamente quien recibió
					una invitación.
				</span>
			</label>
			<label className="flex min-h-11 items-start gap-2 text-sm">
				<input
					type="radio"
					name="ingreso"
					className="mt-1"
					checked={value}
					disabled={isPending || sinDominios}
					onChange={() => setValue(true)}
				/>
				<span>
					<strong>Todos los del dominio.</strong>{" "}
					{sinDominios
						? "Entra sin invitación quien tenga un correo de los dominios de la empresa."
						: `Cualquiera con un correo de ${domainsPhrase(domains)} entra sin invitación, como miembro.`}
				</span>
			</label>

			<p className="text-muted-foreground text-sm">
				{sinDominios
					? "Todavía no hay dominios cargados. Escribinos a hola@innov.as para que los carguemos."
					: "Los dominios los carga INNOV.AS. Escribinos a hola@innov.as para cambiarlos."}
			</p>
			{value ? (
				<p className="text-muted-foreground text-sm">
					{
						"Sacar a alguien de Usuarios no le impide volver a entrar mientras este modo siga activo."
					}
				</p>
			) : null}

			<Button type="submit" size="lg" disabled={isPending || value === open}>
				Guardar
			</Button>
			{message ? <p className="text-destructive text-sm">{message}</p> : null}
		</form>
	);
}
