"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import {
	deleteBrainPage,
	getDeletePreview,
} from "@/app/[tenant]/brain/delete-actions";
import {
	AlertDialog,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import type { DeletePreview } from "@/lib/brain/core/editor/delete";

type Loaded = { preview: DeletePreview };
type Failed = { error: string };

export function DeletePageDialog({
	tenantSlug,
	slug,
	title,
	onClose,
}: {
	tenantSlug: string;
	slug: string;
	title: string;
	onClose: () => void;
}) {
	const router = useRouter();
	const [state, setState] = useState<Loaded | Failed | null>(null);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		let cancelled = false;
		getDeletePreview({ tenantSlug, slug })
			.then((result) => {
				if (cancelled) return;
				setState(
					result.ok ? { preview: result.preview } : { error: result.message },
				);
			})
			.catch(() => {
				if (!cancelled)
					setState({ error: "No se pudo cargar. Probá de nuevo." });
			});
		return () => {
			cancelled = true;
		};
	}, [tenantSlug, slug]);

	async function confirm(preview: DeletePreview) {
		setBusy(true);
		setError(null);
		try {
			const result = await deleteBrainPage({
				tenantSlug,
				slug,
				expectedRevision: preview.revision,
			});
			if (!result.ok) {
				setError(result.message);
				return;
			}
			const folder = slug.includes("/")
				? slug.slice(0, slug.lastIndexOf("/"))
				: null;
			router.push(
				folder
					? `/${tenantSlug}/brain?carpeta=${folder}`
					: `/${tenantSlug}/brain`,
			);
			router.refresh();
			onClose();
		} catch {
			setError("No se pudo borrar. Probá de nuevo.");
		} finally {
			setBusy(false);
		}
	}

	const preview = state && "preview" in state ? state.preview : null;

	return (
		<AlertDialog open onOpenChange={(open) => !open && !busy && onClose()}>
			<AlertDialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
				<AlertDialogHeader>
					<AlertDialogTitle>Borrar "{title}"</AlertDialogTitle>
					<AlertDialogDescription>
						<code className="break-all">{slug}</code>. No se puede deshacer: se
						borra la página con todo su historial.
					</AlertDialogDescription>
				</AlertDialogHeader>

				{state === null && (
					<p className="text-muted-foreground text-sm">Cargando…</p>
				)}
				{state && "error" in state && (
					<p role="alert" className="text-sm">
						{state.error}
					</p>
				)}
				{preview && (
					<div className="space-y-3 text-sm">
						{preview.linkers.length > 0 || preview.hiddenLinkers > 0 ? (
							<div className="space-y-1">
								<p>En estas páginas el link se reemplaza por su texto:</p>
								<ul className="list-disc space-y-0.5 pl-5">
									{preview.linkers.map((linker) => (
										<li key={linker.slug}>
											{linker.title}{" "}
											<span className="break-all text-muted-foreground text-xs">
												{linker.slug}
											</span>
										</li>
									))}
								</ul>
								{preview.hiddenLinkers > 0 && (
									<p className="text-muted-foreground">
										y {preview.hiddenLinkers}{" "}
										{preview.hiddenLinkers === 1 ? "página más" : "páginas más"}{" "}
										que no podés ver.
									</p>
								)}
							</div>
						) : (
							<p className="text-muted-foreground">
								Ninguna otra página enlaza a esta.
							</p>
						)}
						{preview.canonTags.length > 0 && (
							<p>
								<strong>Ojo:</strong> los agentes usan esta página para redactar
								({preview.canonTags.join(", ")}).
							</p>
						)}
						{preview.hasChildren && (
							<p>Las páginas que cuelgan de esta no se borran.</p>
						)}
					</div>
				)}
				{error && (
					<p role="alert" className="text-destructive text-sm">
						{error}
					</p>
				)}

				<AlertDialogFooter>
					<AlertDialogCancel disabled={busy} className="min-h-11">
						Cancelar
					</AlertDialogCancel>
					<Button
						type="button"
						variant="destructive"
						className="min-h-11"
						disabled={busy || !preview}
						onClick={() => preview && confirm(preview)}
					>
						Borrar definitivamente
					</Button>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	);
}
