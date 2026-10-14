"use client";

import { useRouter } from "next/navigation";
import { useId, useState, useTransition } from "react";
import {
	createBrainFolder,
	describeBrainFolder,
} from "@/app/[tenant]/brain/folder-actions";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { MAX_FOLDER_DESCRIPTION } from "@/lib/brain/core/folders";

type Mode =
	| { kind: "create"; parent: string }
	| { kind: "describe"; path: string; description: string };

export function FolderDialog({
	tenantSlug,
	mode,
	onClose,
}: {
	tenantSlug: string;
	mode: Mode;
	onClose: () => void;
}) {
	const router = useRouter();
	const nameId = useId();
	const descriptionId = useId();
	const [name, setName] = useState("");
	const [description, setDescription] = useState(
		mode.kind === "describe" ? mode.description : "",
	);
	const [error, setError] = useState<string | null>(null);
	const [pending, start] = useTransition();
	const creating = mode.kind === "create";
	const prefix = creating && mode.parent ? `${mode.parent}/` : "";

	const submit = () => {
		// Fuera de la transición: adentro no se pinta hasta que termina.
		setError(null);
		start(async () => {
			try {
				const result = creating
					? await createBrainFolder({
							tenantSlug,
							path: `${prefix}${name.trim()}`,
							description,
						})
					: await describeBrainFolder({
							tenantSlug,
							path: mode.path,
							description,
						});
				if (!result.ok) {
					setError(result.message);
					return;
				}
				router.refresh();
				onClose();
			} catch {
				setError("No se pudo guardar. Probá de nuevo.");
			}
		});
	};

	return (
		<Dialog open onOpenChange={(open) => !open && onClose()}>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>
						{creating
							? mode.parent
								? "Nueva subcarpeta"
								: "Nueva carpeta"
							: "Descripción de la carpeta"}
					</DialogTitle>
					<DialogDescription>
						{creating
							? mode.parent
								? `Va dentro de ${mode.parent}.`
								: "Una carpeta de primer nivel es una categoría del brain."
							: mode.path}
					</DialogDescription>
				</DialogHeader>
				{creating && (
					<div className="block space-y-1 text-sm">
						<label htmlFor={nameId}>Nombre</label>
						<div className="flex items-center gap-1">
							{prefix && (
								<span className="text-muted-foreground">{prefix}</span>
							)}
							<Input
								id={nameId}
								autoFocus
								value={name}
								onChange={(e) => setName(e.target.value)}
								placeholder="sucursales"
							/>
						</div>
						<span className="text-muted-foreground text-xs">
							Minúsculas, números y guiones.
						</span>
					</div>
				)}
				<div className="block space-y-1 text-sm">
					<label htmlFor={descriptionId}>Qué va acá</label>
					<Textarea
						id={descriptionId}
						value={description}
						maxLength={MAX_FOLDER_DESCRIPTION}
						onChange={(e) => setDescription(e.target.value)}
						placeholder="Una línea o dos: la ve la gente en el índice y el agente al decidir dónde escribe."
					/>
				</div>
				{error && (
					<p className="text-destructive text-sm" role="alert">
						{error}
					</p>
				)}
				<DialogFooter>
					<Button variant="outline" onClick={onClose} disabled={pending}>
						Cancelar
					</Button>
					<Button
						onClick={submit}
						disabled={pending || (creating && name.trim() === "")}
					>
						{creating ? "Crear" : "Guardar"}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
