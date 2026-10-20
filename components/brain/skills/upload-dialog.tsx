"use client";

import { useRouter } from "next/navigation";
import { useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { pageHref } from "@/lib/brain/core/editor/slug";
import { MAX_ZIP_BYTES } from "@/lib/brain/core/skills/package";
import type {
	UploadFailure,
	UploadPreview,
	UploadResult,
	UploadTarget,
} from "@/lib/brain/core/skills/upload";
import { formatSize } from "./published-files";

type Failure = Pick<UploadFailure, "message" | "problems">;
type Reply = UploadPreview | UploadResult | (Failure & { ok: false });

// Qué se ve: elegir el zip, revisar lo que dice la vista previa (o los
// problemas, todos juntos) y, recién confirmado, el resultado.
type Step =
	| { kind: "pick"; error: string | null }
	| { kind: "checking" }
	| { kind: "review"; preview: UploadPreview }
	| { kind: "refused"; failure: Failure }
	| { kind: "uploading"; preview: UploadPreview }
	| { kind: "done"; result: UploadResult };

const ZIP_TOO_BIG = "El zip supera los 4 MB.";
const NOT_A_ZIP = "Elegí un archivo .zip.";
const NETWORK = "No se pudo subir. Probá de nuevo.";

function countFiles(count: number): string {
	return count === 1 ? "1 archivo" : `${count} archivos`;
}

// El mismo archivo viaja dos veces: para la vista previa y, si la persona
// confirma, para escribir. El servidor vuelve a planificar en cada pedido.
async function post(
	url: string,
	file: File,
	action: "preview" | "confirm",
	target: UploadTarget,
): Promise<Reply> {
	const form = new FormData();
	form.set("action", action);
	form.set("file", file);
	if (target.kind === "folder") form.set("folder", target.folder);
	else form.set("slug", target.slug);
	try {
		const response = await fetch(url, { method: "POST", body: form });
		return (await response.json()) as Reply;
	} catch {
		return { ok: false, message: NETWORK };
	}
}

// `message` ya junta los problemas en una sola frase (y corta a diez): con la
// lista completa alcanza.
function Problems({ failure }: { failure: Failure }) {
	const problems = failure.problems ?? [];
	return (
		<div role="alert" className="text-destructive">
			{problems.length > 0 ? (
				<ul className="list-disc space-y-1 pl-5">
					{problems.map((problem) => (
						<li key={problem}>{problem}</li>
					))}
				</ul>
			) : (
				<p>{failure.message}</p>
			)}
		</div>
	);
}

// El contenido del diálogo sin su cáscara: así se prueba sin el portal.
export function UploadDialogBody({
	tenantSlug,
	target,
	onClose,
}: {
	tenantSlug: string;
	target: UploadTarget;
	onClose: () => void;
}) {
	const router = useRouter();
	const fileId = useId();
	const [step, setStep] = useState<Step>({ kind: "pick", error: null });
	// El archivo se guarda acá y no en el input para mandarlo otra vez al confirmar.
	const file = useRef<File | null>(null);
	const endpoint = `/${tenantSlug}/brain/skills/upload`;
	const busy = step.kind === "checking" || step.kind === "uploading";

	async function choose(chosen: File | undefined) {
		file.current = null;
		if (!chosen) {
			setStep({ kind: "pick", error: null });
			return;
		}
		// Antes de gastar un pedido: el servidor también lo rechaza.
		if (chosen.size > MAX_ZIP_BYTES) {
			setStep({ kind: "pick", error: ZIP_TOO_BIG });
			return;
		}
		if (!/\.zip$/i.test(chosen.name)) {
			setStep({ kind: "pick", error: NOT_A_ZIP });
			return;
		}
		file.current = chosen;
		setStep({ kind: "checking" });
		const reply = await post(endpoint, chosen, "preview", target);
		if (!reply.ok) setStep({ kind: "refused", failure: reply });
		else if ("mode" in reply && "totalBytes" in reply)
			setStep({ kind: "review", preview: reply });
		else setStep({ kind: "pick", error: NETWORK });
	}

	async function confirm(preview: UploadPreview) {
		if (!file.current) return;
		setStep({ kind: "uploading", preview });
		const reply = await post(endpoint, file.current, "confirm", target);
		if (!reply.ok) {
			setStep({ kind: "refused", failure: reply });
			return;
		}
		if (!("revision" in reply)) {
			setStep({ kind: "refused", failure: { message: NETWORK } });
			return;
		}
		router.refresh();
		setStep({ kind: "done", result: reply });
	}

	if (step.kind === "done") {
		return (
			<>
				<div className="space-y-2 text-sm">
					<p>
						{step.result.mode === "crear"
							? `Creaste «${step.result.name}»`
							: `Reemplazaste el borrador de «${step.result.name}»`}
						{" · "}
						{countFiles(step.result.files)}.
					</p>
					<p className="text-muted-foreground">
						Quedó en borrador: un administrador la revisa y la publica.
					</p>
					<a
						className="inline-block underline"
						href={pageHref(tenantSlug, step.result.slug)}
					>
						Abrir la skill
					</a>
				</div>
				<DialogFooter>
					<Button onClick={onClose}>Cerrar</Button>
				</DialogFooter>
			</>
		);
	}

	const preview =
		step.kind === "review" || step.kind === "uploading" ? step.preview : null;
	// Con problemas no hay vista previa: el rótulo sigue al destino.
	const replacing = preview
		? preview.mode === "reemplazar"
		: target.kind === "skill";

	return (
		<>
			<div className="min-w-0 space-y-3 text-sm">
				<div className="space-y-1">
					<label htmlFor={fileId}>Paquete de la skill (.zip)</label>
					<input
						id={fileId}
						type="file"
						accept=".zip,application/zip"
						disabled={busy}
						className="block w-full"
						onChange={(e) => choose(e.target.files?.[0])}
					/>
					<p className="text-muted-foreground text-xs">
						Un .zip de hasta 4 MB con el SKILL.md adentro. El name del SKILL.md
						es obligatorio.
					</p>
				</div>

				{step.kind === "pick" && step.error && (
					<p role="alert" className="text-destructive">
						{step.error}
					</p>
				)}
				{step.kind === "checking" && (
					<p role="status" className="text-muted-foreground">
						Revisando…
					</p>
				)}
				{step.kind === "refused" && <Problems failure={step.failure} />}
				{preview && (
					<div className="space-y-3">
						<div className="space-y-1">
							<p className="font-medium">{preview.name}</p>
							<p>{preview.description || "(sin descripción)"}</p>
							<p className="text-muted-foreground">
								{countFiles(preview.files.length)} ·{" "}
								{formatSize(preview.totalBytes)}
							</p>
						</div>
						<p className="font-medium">
							{preview.mode === "crear"
								? "Crea una skill nueva"
								: `Reemplaza el borrador de ${preview.slug}`}
						</p>
						{preview.mode === "reemplazar" && (
							<p>
								Reemplazar cambia el texto y los archivos del borrador por los
								del paquete. No publica nada.
							</p>
						)}
						{preview.warnings.map((warning) => (
							<p key={warning} className="text-muted-foreground">
								{warning}
							</p>
						))}
						<ul className="max-h-40 divide-y overflow-y-auto rounded-md border">
							{preview.files.map((entry) => (
								<li key={entry.path} className="flex gap-2 px-2 py-1">
									<span className="mr-auto break-all">{entry.path}</span>
									<span className="shrink-0 text-muted-foreground">
										{formatSize(entry.size)}
									</span>
								</li>
							))}
						</ul>
					</div>
				)}
			</div>
			<DialogFooter>
				<Button variant="outline" onClick={onClose} disabled={busy}>
					Cancelar
				</Button>
				{(preview || step.kind === "refused") && (
					<Button
						disabled={busy || !preview}
						onClick={() => preview && confirm(preview)}
					>
						{step.kind === "uploading"
							? "Subiendo…"
							: replacing
								? "Reemplazar el borrador"
								: "Crear la skill"}
					</Button>
				)}
			</DialogFooter>
		</>
	);
}

// Subir una skill desde un zip (spec etapa 24.6 D1, D5 y D11): desde una
// carpeta de skills/ o desde el panel de una skill. Primero vista previa, que
// no escribe; después la confirmación.
export function UploadDialog({
	tenantSlug,
	target,
	onClose,
}: {
	tenantSlug: string;
	target: UploadTarget;
	onClose: () => void;
}) {
	return (
		<Dialog open onOpenChange={(open) => !open && onClose()}>
			<DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
				<DialogHeader>
					<DialogTitle>Subir skill</DialogTitle>
					<DialogDescription>
						{target.kind === "folder"
							? `Va en skills/${target.folder}`
							: `Actualiza ${target.slug}`}
						. Queda en borrador hasta que un administrador la publique.
					</DialogDescription>
				</DialogHeader>
				<UploadDialogBody
					tenantSlug={tenantSlug}
					target={target}
					onClose={onClose}
				/>
			</DialogContent>
		</Dialog>
	);
}
