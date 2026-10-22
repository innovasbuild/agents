"use client";

import { useRouter } from "next/navigation";
import { useEffect, useId, useState } from "react";
import {
	getPublishPreview,
	publishSkillAction,
} from "@/app/[tenant]/brain/skill-actions";
import { DiffView } from "@/components/brain/diff-view";
import { LimitDialog } from "@/components/plan/limit-dialog";
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
import { Textarea } from "@/components/ui/textarea";
import { diffLines } from "@/lib/brain/core/diff";
import { skillFileHref } from "@/lib/brain/core/skills/http";
import {
	PUBLISH_MESSAGES,
	type SkillFile,
} from "@/lib/brain/core/skills/package";
import type { PublishPreview } from "@/lib/brain/core/skills/publish";
import type { LimitReason } from "@/lib/plans/limits";
import { formatSize } from "./published-files";

type Loaded = { preview: PublishPreview };
type Failed = { error: string };

function FileGroup({
	label,
	files,
	tenantSlug,
	slug,
	linked,
}: {
	label: string;
	files: SkillFile[];
	tenantSlug: string;
	slug: string;
	linked: boolean;
}) {
	if (files.length === 0) return null;
	return (
		<div>
			<p className="font-medium">{label}</p>
			<ul className="list-disc pl-5">
				{files.map((file) => (
					<li key={file.path} className="break-all">
						{linked ? (
							<a
								className="underline"
								href={skillFileHref(tenantSlug, slug, file.path)}
								target="_blank"
								rel="noreferrer"
							>
								{file.path}
							</a>
						) : (
							file.path
						)}{" "}
						<span className="text-muted-foreground">
							({formatSize(file.size)})
						</span>
					</li>
				))}
			</ul>
		</div>
	);
}

// Revisión antes de publicar (spec 24.1 §8.2): lo que se confirma es la
// revisión y el hash de archivos que se cargaron acá.
export function PublishDialog({
	tenantSlug,
	slug,
	onClose,
}: {
	tenantSlug: string;
	slug: string;
	onClose: () => void;
}) {
	const router = useRouter();
	const noteId = useId();
	const [state, setState] = useState<Loaded | Failed | null>(null);
	const [note, setNote] = useState("");
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [limit, setLimit] = useState<LimitReason | null>(null);

	useEffect(() => {
		let cancelled = false;
		getPublishPreview({ tenantSlug, slug })
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

	async function confirm(preview: PublishPreview) {
		setBusy(true);
		setError(null);
		try {
			const result = await publishSkillAction({
				tenantSlug,
				slug,
				expectedRevision: preview.revision,
				expectedFilesDigest: preview.filesDigest,
				note,
			});
			if (result.ok) {
				router.refresh();
				onClose();
				return;
			}
			if ("reason" in result && result.reason) {
				setLimit(result.reason);
				return;
			}
			setError(result.message);
		} catch {
			setError("No se pudo publicar. Probá de nuevo.");
		} finally {
			setBusy(false);
		}
	}

	const preview = state && "preview" in state ? state.preview : null;
	const hasFileChanges =
		preview !== null &&
		preview.files.added.length +
			preview.files.changed.length +
			preview.files.removed.length >
			0;

	// El tope del plan reemplaza a la revisión: un solo diálogo a la vez.
	if (limit) {
		return (
			<LimitDialog
				onOpenChange={(open) => {
					if (!open) onClose();
				}}
				open
				reason={limit}
			/>
		);
	}

	return (
		<AlertDialog open onOpenChange={(open) => !open && onClose()}>
			<AlertDialogContent className="max-h-[90vh] overflow-y-auto data-[size=default]:sm:max-w-3xl">
				<AlertDialogHeader>
					<AlertDialogTitle>
						Publicar {preview ? `«${preview.name}»` : "skill"}
					</AlertDialogTitle>
					<AlertDialogDescription>
						Lo que publiques es lo que van a recibir los asistentes de quienes
						tengan acceso a esta skill.
					</AlertDialogDescription>
				</AlertDialogHeader>

				{state === null && <p className="text-sm">Cargando…</p>}
				{state && "error" in state && (
					<p className="text-destructive text-sm">{state.error}</p>
				)}
				{preview && (
					<div className="min-w-0 space-y-4 text-sm">
						{preview.problems.length > 0 && (
							<ul className="list-disc space-y-1 pl-5 text-destructive">
								{preview.problems.map((problem) => (
									<li key={problem}>{PUBLISH_MESSAGES[problem]}</li>
								))}
							</ul>
						)}
						{preview.warnings.map((warning) => (
							<p key={warning} className="text-muted-foreground">
								{PUBLISH_MESSAGES[warning]}
							</p>
						))}

						<section className="space-y-1">
							<h3 className="font-medium">Descripción</h3>
							<p>{preview.description || "(sin descripción)"}</p>
							{preview.previousDescription !== null &&
								preview.previousDescription !== preview.description && (
									<p className="text-muted-foreground">
										Antes: {preview.previousDescription}
									</p>
								)}
						</section>

						<section className="space-y-1">
							<h3 className="font-medium">
								{preview.previousBody === null
									? "Texto (primera publicación)"
									: "Cambios en el texto"}
							</h3>
							<DiffView
								blocks={diffLines(preview.previousBody ?? "", preview.body)}
							/>
						</section>

						<section className="space-y-2">
							<h3 className="font-medium">Archivos</h3>
							{hasFileChanges ? (
								<>
									<FileGroup
										label="Agregados"
										files={preview.files.added}
										tenantSlug={tenantSlug}
										slug={slug}
										linked
									/>
									<FileGroup
										label="Cambiados"
										files={preview.files.changed}
										tenantSlug={tenantSlug}
										slug={slug}
										linked
									/>
									<FileGroup
										label="Quitados"
										files={preview.files.removed}
										tenantSlug={tenantSlug}
										slug={slug}
										linked={false}
									/>
								</>
							) : (
								<p className="text-muted-foreground">
									Sin cambios en archivos.
								</p>
							)}
						</section>

						{preview.editorIds.length > 0 && (
							<p className="text-muted-foreground">
								{preview.editorIds.length === 1
									? "Una persona editó"
									: `${preview.editorIds.length} personas editaron`}{" "}
								el borrador desde la última publicación. El detalle está en el
								historial de la página.
							</p>
						)}

						<label htmlFor={noteId} className="block space-y-1">
							<span>Nota de publicación</span>
							<Textarea
								id={noteId}
								value={note}
								maxLength={500}
								onChange={(e) => setNote(e.target.value)}
								placeholder="Qué cambia en esta versión"
							/>
						</label>
						{error && <p className="text-destructive">{error}</p>}
					</div>
				)}

				<AlertDialogFooter>
					<AlertDialogCancel type="button" disabled={busy}>
						Cancelar
					</AlertDialogCancel>
					{preview && (
						<Button
							type="button"
							disabled={
								busy || preview.problems.length > 0 || note.trim().length === 0
							}
							onClick={() => confirm(preview)}
						>
							{busy ? "Publicando…" : "Publicar"}
						</Button>
					)}
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	);
}
