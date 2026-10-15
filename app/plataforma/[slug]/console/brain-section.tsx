// app/plataforma/[slug]/console/brain-section.tsx
"use client";

import Link from "next/link";
import { createBrain, enableBrainSkills } from "../console-actions";
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
	const skillsMissing =
		brain.enabled !== false && !brain.categories.includes("skill");
	return (
		<div className="flex flex-wrap items-center gap-3 rounded-lg border bg-card px-4 py-3 text-sm">
			<div className="min-w-0 flex-1">
				<div>
					Proveedor {brain.provider} · desde el {fecha(brain.createdAt)}
				</div>
				<div className="mt-2 text-xs">
					<span className="text-muted-foreground">Categorías: </span>
					{brain.categories.join(", ")}
				</div>
				<p className="text-muted-foreground text-xs">
					Son las carpetas de primer nivel.{" "}
					<Link className="underline" href={`/${slug}/brain`}>
						Editar en el brain
					</Link>
					.
				</p>
				{brain.enabled === false ? (
					<div className="text-muted-foreground text-xs">Deshabilitado</div>
				) : null}
				{skillsMissing ? (
					<div className="mt-3 flex flex-wrap items-center gap-3">
						<p className="min-w-0 flex-1 text-muted-foreground text-xs">
							Esta empresa no tiene skills. Habilitarlas crea la carpeta{" "}
							<code>skills</code> y deja publicar skills de empresa.
						</p>
						<ConsoleButton
							label="Habilitar skills"
							run={() => enableBrainSkills(slug, tenantId)}
						/>
					</div>
				) : null}
			</div>
			<Link className="underline underline-offset-4" href={`/${slug}/brain`}>
				Abrir
			</Link>
		</div>
	);
}
