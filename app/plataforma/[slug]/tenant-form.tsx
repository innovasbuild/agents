"use client";

import { useRef, useState, useTransition } from "react";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { parseList } from "@/lib/tenants/tenant-form";
import { updateTenant } from "./actions";

export interface TenantFormValues {
	id: string;
	slug: string;
	displayName: string;
	allowedDomains: string[];
	selfSignupByDomain: boolean;
	allowedModels: string[];
	defaultModel: string;
	primary: string;
	secondary: string;
	logoSrc: string | null;
	active: boolean;
}

export function TenantForm({
	tenant,
	isOwner,
}: {
	tenant: TenantFormValues;
	isOwner: boolean;
}) {
	const formRef = useRef<HTMLFormElement>(null);
	const [models, setModels] = useState(tenant.allowedModels.join("\n"));
	const [defaultModel, setDefaultModel] = useState(tenant.defaultModel);
	const [active, setActive] = useState(tenant.active);
	const [confirmOpen, setConfirmOpen] = useState(false);
	const [message, setMessage] = useState<string | null>(null);
	const [saved, setSaved] = useState(false);
	const [isPending, startTransition] = useTransition();

	const modelOptions = parseList(models);

	function save() {
		const form = formRef.current;
		if (!form) return;
		const formData = new FormData(form);
		startTransition(async () => {
			const result = await updateTenant(tenant.id, formData);
			setMessage(result.ok ? null : result.message);
			setSaved(result.ok);
		});
	}

	return (
		<form
			ref={formRef}
			className="space-y-5"
			onSubmit={(event) => {
				event.preventDefault();
				setSaved(false);
				// Desactivar deja al cliente en 404 para todos sus usuarios: se
				// confirma antes de guardar.
				if (tenant.active && !active) setConfirmOpen(true);
				else save();
			}}
		>
			<div className="space-y-1">
				<label htmlFor="display_name" className="text-sm">
					Nombre
				</label>
				<Input
					id="display_name"
					name="display_name"
					defaultValue={tenant.displayName}
					maxLength={80}
					required
				/>
			</div>

			<div className="space-y-1">
				<span className="text-sm">Slug</span>
				<p className="rounded-md border bg-muted px-3 py-2 text-muted-foreground text-sm">
					{tenant.slug}
				</p>
				<p className="text-muted-foreground text-xs">
					No se edita: cambiarlo rompe las direcciones del cliente.
				</p>
			</div>

			<div className="space-y-1">
				<label htmlFor="allowed_domains" className="text-sm">
					Dominios permitidos
				</label>
				<Textarea
					id="allowed_domains"
					name="allowed_domains"
					rows={3}
					defaultValue={tenant.allowedDomains.join("\n")}
				/>
				<p className="text-muted-foreground text-xs">Uno por línea.</p>
			</div>

			<label className="flex min-h-11 items-center gap-2 text-sm">
				<input
					type="checkbox"
					name="self_signup_by_domain"
					defaultChecked={tenant.selfSignupByDomain}
				/>
				Permitir el alta a quien tenga un correo de esos dominios
			</label>

			<div className="space-y-1">
				<label htmlFor="allowed_models" className="text-sm">
					Modelos permitidos
				</label>
				<Textarea
					id="allowed_models"
					name="allowed_models"
					rows={3}
					value={models}
					onChange={(event) => setModels(event.target.value)}
				/>
				<p className="text-muted-foreground text-xs">
					Uno por línea, como proveedor/modelo.
				</p>
			</div>

			<div className="space-y-1">
				<label htmlFor="default_model" className="text-sm">
					Modelo por defecto
				</label>
				<select
					id="default_model"
					name="default_model"
					className="h-11 w-full rounded-md border bg-background px-3 text-sm"
					value={defaultModel}
					onChange={(event) => setDefaultModel(event.target.value)}
				>
					{/* Si el default actual salió de la lista, se sigue mostrando: la
					    action lo rechaza con el mensaje del campo en vez de que el
					    select cambie de valor sin avisar. */}
					{[...new Set([defaultModel, ...modelOptions])].map((model) => (
						<option key={model} value={model}>
							{model}
						</option>
					))}
				</select>
			</div>

			<div className="grid gap-4 sm:grid-cols-2">
				<div className="space-y-1">
					<label htmlFor="primary" className="text-sm">
						Color primario
					</label>
					<Input
						id="primary"
						name="primary"
						defaultValue={tenant.primary}
						placeholder="#1D4ED8"
					/>
				</div>
				<div className="space-y-1">
					<label htmlFor="secondary" className="text-sm">
						Color secundario
					</label>
					<Input
						id="secondary"
						name="secondary"
						defaultValue={tenant.secondary}
						placeholder="#0F172A"
					/>
				</div>
			</div>

			<div className="space-y-2">
				<label htmlFor="logo" className="text-sm">
					Logo
				</label>
				{tenant.logoSrc ? (
					// biome-ignore lint/performance/noImgElement: el logo es del cliente, sin loader
					<img
						src={tenant.logoSrc}
						alt={`Logo de ${tenant.displayName}`}
						className="h-auto max-h-10 w-auto max-w-[180px]"
					/>
				) : null}
				<input
					id="logo"
					name="logo"
					type="file"
					accept="image/png,image/svg+xml,image/webp"
					className="block text-sm"
				/>
				<p className="text-muted-foreground text-xs">
					PNG, SVG o WebP de hasta 1 MB.
				</p>
			</div>

			<div className="space-y-1">
				<label className="flex min-h-11 items-center gap-2 text-sm">
					{/* disabled saca al checkbox del form: el hidden mantiene `active`. */}
					{isOwner ? <input type="hidden" name="active" value="on" /> : null}
					<input
						type="checkbox"
						name="active"
						checked={active}
						disabled={isOwner}
						onChange={(event) => setActive(event.target.checked)}
					/>
					Activo
				</label>
				{isOwner ? (
					<p className="text-muted-foreground text-xs">
						El tenant dueño de la plataforma no se puede desactivar.
					</p>
				) : null}
			</div>

			<div className="flex flex-wrap items-center gap-3">
				<Button type="submit" size="lg" disabled={isPending}>
					{isPending ? "Guardando…" : "Guardar"}
				</Button>
				{message ? (
					<p role="alert" className="text-destructive text-sm">
						{message}
					</p>
				) : null}
				{saved ? (
					<output className="text-muted-foreground text-sm">
						Cambios guardados.
					</output>
				) : null}
			</div>

			<AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>
							¿Desactivar {tenant.displayName}?
						</AlertDialogTitle>
						<AlertDialogDescription>
							Sus usuarios dejan de poder entrar hasta que lo vuelvas a activar
							desde esta pantalla.
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel>Cancelar</AlertDialogCancel>
						<AlertDialogAction onClick={save}>Desactivar</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</form>
	);
}
