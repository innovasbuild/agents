// app/plataforma/[slug]/console/brain-section.tsx
"use client";

import Link from "next/link";
import { useState } from "react";
import { Input } from "@/components/ui/input";
import { createBrain, setBrainCategories } from "../console-actions";
import { ConsoleButton } from "./console-button";

export interface BrainState {
	provider: string;
	categories: string[];
	createdAt: string;
	enabled?: boolean;
}

const fecha = (value: string) => new Date(value).toLocaleDateString("es-AR");

function CategoriesForm({
	slug,
	tenantId,
	categories,
}: {
	slug: string;
	tenantId: string;
	categories: string[];
}) {
	const [value, setValue] = useState(categories.join(", "));
	return (
		<div className="mt-2 flex flex-wrap items-center gap-2">
			<label
				className="text-muted-foreground text-xs"
				htmlFor="brain-categories"
			>
				Categorías
			</label>
			<Input
				className="h-8 min-w-0 flex-1 text-xs"
				id="brain-categories"
				onChange={(event) => setValue(event.target.value)}
				value={value}
			/>
			<ConsoleButton
				label="Guardar"
				run={() => setBrainCategories(slug, tenantId, value)}
			/>
		</div>
	);
}

export function BrainSection({
	slug,
	tenantId,
	brain,
}: {
	slug: string;
	tenantId: string;
	brain: BrainState | null;
}) {
	if (!brain) {
		return (
			<div className="flex flex-wrap items-center gap-3 rounded-lg border bg-card px-4 py-3 text-sm">
				<span className="min-w-0 flex-1 text-muted-foreground">
					La empresa todavía no tiene brain. Nace con permisos de lectura para
					sus miembros.
				</span>
				<ConsoleButton
					label="Crear brain"
					run={() => createBrain(slug, tenantId)}
					variant="default"
				/>
			</div>
		);
	}
	return (
		<div className="flex flex-wrap items-center gap-3 rounded-lg border bg-card px-4 py-3 text-sm">
			<div className="min-w-0 flex-1">
				<div>
					Proveedor {brain.provider} · desde el {fecha(brain.createdAt)}
				</div>
				<CategoriesForm
					categories={brain.categories}
					slug={slug}
					tenantId={tenantId}
				/>
				<p className="text-muted-foreground text-xs">
					Separadas por coma. No se puede quitar una que tenga páginas.
				</p>
				{brain.enabled === false ? (
					<div className="text-muted-foreground text-xs">Deshabilitado</div>
				) : null}
			</div>
			<Link className="underline underline-offset-4" href={`/${slug}/brain`}>
				Abrir
			</Link>
		</div>
	);
}
