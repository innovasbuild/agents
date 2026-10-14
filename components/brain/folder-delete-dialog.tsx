"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { deleteBrainFolder } from "@/app/[tenant]/brain/folder-actions";
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

export function FolderDeleteDialog({
	tenantSlug,
	path,
	onClose,
}: {
	tenantSlug: string;
	path: string;
	onClose: () => void;
}) {
	const router = useRouter();
	const [error, setError] = useState<string | null>(null);
	const [pending, start] = useTransition();
	return (
		<AlertDialog open onOpenChange={(open) => !open && onClose()}>
			<AlertDialogContent>
				<AlertDialogHeader>
					<AlertDialogTitle>¿Borrar la carpeta {path}?</AlertDialogTitle>
					<AlertDialogDescription>
						Solo se puede borrar una carpeta vacía. Sus permisos se borran con
						ella.
					</AlertDialogDescription>
				</AlertDialogHeader>
				{error && (
					<p className="text-destructive text-sm" role="alert">
						{error}
					</p>
				)}
				<AlertDialogFooter>
					<AlertDialogCancel disabled={pending}>Cancelar</AlertDialogCancel>
					<AlertDialogAction
						disabled={pending}
						onClick={(event) => {
							event.preventDefault();
							// Fuera de la transición: adentro no se pinta hasta que termina.
							setError(null);
							start(async () => {
								try {
									const result = await deleteBrainFolder({ tenantSlug, path });
									if (!result.ok) {
										setError(result.message);
										return;
									}
									router.refresh();
									onClose();
								} catch {
									setError("No se pudo borrar. Probá de nuevo.");
								}
							});
						}}
					>
						Borrar
					</AlertDialogAction>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	);
}
