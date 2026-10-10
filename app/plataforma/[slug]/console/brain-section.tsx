// app/plataforma/[slug]/console/brain-section.tsx
"use client";

import Link from "next/link";
import { createBrain } from "../console-actions";
import { ConsoleButton } from "./console-button";

export interface BrainState {
	provider: string;
	categories: string[];
	createdAt: string;
	enabled?: boolean;
}

const fecha = (value: string) => new Date(value).toLocaleDateString("es-AR");

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
					La empresa todavía no tiene brain. Nace vacío, con permisos abiertos
					para sus miembros.
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
				<div className="text-muted-foreground text-xs">
					Categorías: {brain.categories.join(", ")}
				</div>
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
