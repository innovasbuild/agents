"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { AUTH_METHOD_LABELS, AUTH_METHODS } from "@/lib/tenants/auth-methods";
import { createTenant } from "./actions";

export function CreateForm() {
	const router = useRouter();
	const formRef = useRef<HTMLFormElement>(null);
	const [message, setMessage] = useState<string | null>(null);
	const [isPending, startTransition] = useTransition();

	return (
		<form
			ref={formRef}
			className="space-y-5"
			onSubmit={(event) => {
				event.preventDefault();
				const form = formRef.current;
				if (!form) return;
				const formData = new FormData(form);
				startTransition(async () => {
					const result = await createTenant(formData);
					if (!result.ok) {
						setMessage(result.message);
						return;
					}
					// Las advertencias viajan en la URL: la pantalla de destino es
					// un server component y no comparte estado con este form.
					const params = new URLSearchParams();
					for (const warning of result.warnings)
						params.append("aviso", warning);
					const query = params.toString();
					router.push(`/plataforma/${result.slug}${query ? `?${query}` : ""}`);
				});
			}}
		>
			<div className="space-y-1">
				<label htmlFor="display_name" className="text-sm">
					Nombre
				</label>
				<Input id="display_name" name="display_name" maxLength={80} required />
			</div>

			<div className="space-y-1">
				<label htmlFor="slug" className="text-sm">
					Slug
				</label>
				<Input id="slug" name="slug" placeholder="acme" required />
				<p className="text-muted-foreground text-xs">
					Va en la dirección: /slug/chat y /login/slug. Minúsculas, números y
					guiones. No se cambia después.
				</p>
			</div>

			<div className="space-y-1">
				<label htmlFor="allowed_domains" className="text-sm">
					Dominios permitidos
				</label>
				<Textarea
					id="allowed_domains"
					name="allowed_domains"
					rows={2}
					placeholder="acme.com"
				/>
				<p className="text-muted-foreground text-xs">
					Uno por línea. Vacío: sin restricción.
				</p>
			</div>

			<fieldset className="space-y-1">
				<legend className="text-sm">Métodos de login</legend>
				{AUTH_METHODS.map((method) => (
					<label
						key={method}
						className="flex min-h-11 items-center gap-2 text-sm"
					>
						<input
							type="checkbox"
							name="auth_methods"
							value={method}
							defaultChecked
						/>
						{AUTH_METHOD_LABELS[method]}
					</label>
				))}
			</fieldset>

			<div className="grid gap-4 sm:grid-cols-2">
				<div className="space-y-1">
					<label htmlFor="primary" className="text-sm">
						Color primario
					</label>
					<Input id="primary" name="primary" placeholder="#1D4ED8" />
				</div>
				<div className="space-y-1">
					<label htmlFor="secondary" className="text-sm">
						Color secundario
					</label>
					<Input id="secondary" name="secondary" placeholder="#0F172A" />
				</div>
			</div>

			<div className="space-y-1">
				<label htmlFor="logo" className="text-sm">
					Logo
				</label>
				<input
					id="logo"
					name="logo"
					type="file"
					accept="image/png,image/svg+xml,image/webp"
					className="block text-sm"
				/>
				<p className="text-muted-foreground text-xs">
					PNG, SVG o WebP de hasta 1 MB. Opcional.
				</p>
			</div>

			<div className="space-y-1">
				<label htmlFor="admin_email" className="text-sm">
					Correo del primer administrador
				</label>
				<Input id="admin_email" name="admin_email" type="email" required />
				<label className="flex min-h-11 items-center gap-2 text-sm">
					<input type="checkbox" name="allow_external_admin" />
					Permitir correo externo a los dominios
				</label>
			</div>

			<div className="flex flex-wrap items-center gap-3">
				<Button type="submit" size="lg" disabled={isPending}>
					{isPending ? "Creando…" : "Crear empresa"}
				</Button>
				{message ? (
					<p role="alert" className="text-destructive text-sm">
						{message}
					</p>
				) : null}
			</div>
		</form>
	);
}
