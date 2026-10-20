"use client";

import { useRouter } from "next/navigation";
import { useId, useRef, useState, useTransition } from "react";
import {
	removeSkillFileAction,
	republishSkillAction,
	withdrawSkillAction,
} from "@/app/[tenant]/brain/skill-actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { skillFileHref, skillPackageHref } from "@/lib/brain/core/skills/http";
import type { SkillFile } from "@/lib/brain/core/skills/package";
import {
	type SkillState,
	skillStateLabel,
} from "@/lib/brain/core/skills/state";
import {
	collectDropped,
	type LooseEntry,
	type LooseResult,
	looseFilePath,
	uploadLoose,
} from "./loose-files";
import { PublishDialog } from "./publish-dialog";
import { formatSize } from "./published-files";
import { UploadDialog } from "./upload-dialog";

export interface SkillVersionRow {
	id: number;
	action: "publicar" | "retirar";
	version: number;
	note: string;
	createdAt: string;
	republishedFrom: number | null;
}

export interface SkillPanelProps {
	tenantSlug: string;
	slug: string;
	state: SkillState;
	files: SkillFile[];
	versions: SkillVersionRow[];
	canPublish: boolean;
}

// Estado, archivos y versiones de una skill (spec 24.1 §6 y §8), para quien la
// edita. Publicar, republicar y retirar aparecen solo para un administrador.
export function SkillPanel({
	tenantSlug,
	slug,
	state,
	files,
	versions,
	canPublish,
}: SkillPanelProps) {
	const router = useRouter();
	const pathId = useId();
	const filesInput = useRef<HTMLInputElement>(null);
	const folderInput = useRef<HTMLInputElement>(null);
	const [path, setPath] = useState("");
	const [message, setMessage] = useState<string | null>(null);
	const [publishing, setPublishing] = useState(false);
	const [uploadingZip, setUploadingZip] = useState(false);
	const [uploadingLoose, setUploadingLoose] = useState(false);
	const [dragging, setDragging] = useState(false);
	const [summary, setSummary] = useState<LooseResult | null>(null);
	const [isPending, startTransition] = useTransition();

	const endpoint = `/${tenantSlug}/brain/skills/files`;
	const publishable = state.kind !== "publicada" || state.dirty;
	// Una subida a la vez: un zip que reemplaza borra lo que el paquete no
	// trae, y publicar congela lo que haya. Ninguno corre a mitad de un lote.
	const looseBlocked = uploadingLoose || uploadingZip;
	const busy = isPending || uploadingLoose;

	async function post(file: File, filePath: string) {
		const form = new FormData();
		form.set("slug", slug);
		form.set("path", filePath);
		form.set("file", file);
		const response = await fetch(endpoint, { method: "POST", body: form });
		return (await response.json()) as { ok: boolean; message?: string };
	}

	// Un pedido por archivo, de a uno: la ruta del servidor decide cada uno.
	async function sendLoose(entries: LooseEntry[]) {
		if (looseBlocked) return;
		setMessage(null);
		setSummary(null);
		if (entries.length === 0) {
			setMessage("No encontré archivos para subir.");
			return;
		}
		// La ruta escrita a mano vale cuando se sube un solo archivo.
		const override = path.trim();
		const toSend =
			entries.length === 1 && override
				? [{ file: entries[0].file, path: override }]
				: entries;
		setUploadingLoose(true);
		try {
			setSummary(await uploadLoose(toSend, post));
			setPath("");
			router.refresh();
		} finally {
			setUploadingLoose(false);
		}
	}

	function pickFromInput(input: HTMLInputElement) {
		const entries = Array.from(input.files ?? []).map((file) => ({
			file,
			path: looseFilePath(file),
		}));
		// Ya están leídos: se vacía el campo para poder elegir lo mismo otra vez.
		input.value = "";
		void sendLoose(entries);
	}

	async function onDrop(event: React.DragEvent) {
		event.preventDefault();
		setDragging(false);
		if (looseBlocked) return;
		try {
			await sendLoose(await collectDropped(event.dataTransfer.items));
		} catch {
			setMessage("No pude leer lo que arrastraste. Probá con Elegir carpeta.");
		}
	}

	function run(
		action: () => Promise<{ ok: boolean; message?: string }>,
		failure: string,
	) {
		setMessage(null);
		startTransition(async () => {
			try {
				const result = await action();
				if (!result.ok) {
					setMessage(result.message ?? failure);
					return;
				}
				router.refresh();
			} catch {
				setMessage(failure);
			}
		});
	}

	function askNote(question: string): string | null {
		const note = window.prompt(question)?.trim();
		return note ? note : null;
	}

	return (
		<section className="space-y-4 rounded-lg border p-3 text-sm">
			<div className="space-y-2">
				<h2 className="font-medium">Skill</h2>
				<p>{skillStateLabel(state)}</p>
				{state.kind === "publicada" && (
					<a
						className="inline-block underline"
						href={skillPackageHref(tenantSlug, slug)}
						download
					>
						Descargar paquete (v{state.version})
					</a>
				)}
				{canPublish ? (
					<div className="flex flex-wrap gap-2">
						{publishable && (
							<Button
								type="button"
								size="sm"
								disabled={busy}
								onClick={() => setPublishing(true)}
							>
								Revisar y publicar
							</Button>
						)}
						{state.kind === "publicada" && (
							<Button
								type="button"
								size="sm"
								variant="outline"
								disabled={busy}
								onClick={() => {
									const note = askNote(
										"¿Por qué se retira? Queda en el registro.",
									);
									if (!note) return;
									run(
										() => withdrawSkillAction({ tenantSlug, slug, note }),
										"No se pudo retirar.",
									);
								}}
							>
								Retirar
							</Button>
						)}
					</div>
				) : (
					<p className="text-muted-foreground">
						La publica un administrador de la empresa.
					</p>
				)}
				<p className="text-muted-foreground">
					Se publica lo guardado: guardá los cambios del texto antes de revisar.
				</p>
			</div>

			<div className="space-y-2">
				<h3 className="font-medium">Archivos del borrador</h3>
				{files.length === 0 ? (
					<p className="text-muted-foreground">Todavía no hay archivos.</p>
				) : (
					<ul className="divide-y rounded-md border">
						{files.map((file) => (
							<li key={file.path} className="flex items-center gap-2 px-2 py-1">
								<a
									className="mr-auto break-all underline"
									href={skillFileHref(tenantSlug, slug, file.path)}
									target="_blank"
									rel="noreferrer"
								>
									{file.path}
								</a>
								<span className="shrink-0 text-muted-foreground">
									{formatSize(file.size)}
								</span>
								<Button
									type="button"
									size="sm"
									variant="ghost"
									disabled={isPending}
									aria-label={`Quitar ${file.path}`}
									onClick={() =>
										run(
											() =>
												removeSkillFileAction({
													tenantSlug,
													slug,
													path: file.path,
												}),
											"No se pudo quitar.",
										)
									}
								>
									Quitar
								</Button>
							</li>
						))}
					</ul>
				)}

				{/* biome-ignore lint/a11y/noStaticElementInteractions: la zona solo recibe lo que se suelta; elegir archivos y carpeta tienen sus botones */}
				<div
					className={`space-y-2 rounded-md border border-dashed p-3 ${
						dragging ? "border-foreground bg-muted" : ""
					}`}
					onDragOver={(e) => {
						e.preventDefault();
						if (!looseBlocked) setDragging(true);
					}}
					onDragLeave={() => setDragging(false)}
					onDrop={onDrop}
				>
					<p>Arrastrá archivos o una carpeta</p>
					<div className="flex flex-wrap gap-2">
						<Button
							type="button"
							size="sm"
							variant="outline"
							disabled={isPending || looseBlocked}
							onClick={() => filesInput.current?.click()}
						>
							Elegir archivos…
						</Button>
						<Button
							type="button"
							size="sm"
							variant="outline"
							disabled={isPending || looseBlocked}
							onClick={() => folderInput.current?.click()}
						>
							Elegir carpeta…
						</Button>
					</div>
					<input
						ref={filesInput}
						type="file"
						multiple
						hidden
						aria-label="Elegir archivos"
						onChange={(e) => pickFromInput(e.target)}
					/>
					<input
						ref={folderInput}
						type="file"
						multiple
						hidden
						aria-label="Elegir carpeta"
						{...{ webkitdirectory: "" }}
						onChange={(e) => pickFromInput(e.target)}
					/>
					{uploadingLoose && <p role="status">Subiendo…</p>}
					<p className="text-muted-foreground">
						Cada archivo se sube aparte, sin vista previa. Hasta 4 MB por
						archivo, 50 archivos y 20 MB en total. La carpeta que arrastrás no
						forma parte de la ruta.
					</p>
					<details>
						<summary className="cursor-pointer">Cambiar la ruta</summary>
						<label htmlFor={pathId} className="mt-2 block space-y-1">
							<span>Ruta dentro del paquete</span>
							<Input
								id={pathId}
								value={path}
								placeholder="scripts/calcular.py"
								onChange={(e) => setPath(e.target.value)}
							/>
						</label>
						<p className="text-muted-foreground">
							Vale cuando subís un solo archivo. Si queda vacía se usa su
							nombre.
						</p>
					</details>
				</div>
				{summary && (
					<div role="status" className="space-y-1">
						<p>
							Subieron {summary.sent} de {summary.total}
						</p>
						{summary.notices.map((notice) => (
							<p key={notice} className="text-muted-foreground">
								{notice}
							</p>
						))}
						{summary.failures.length > 0 && (
							<ul className="text-destructive">
								{summary.failures.map((failure) => (
									<li key={failure.path} className="break-all">
										{failure.path}: {failure.reason}
									</li>
								))}
							</ul>
						)}
					</div>
				)}
			</div>

			<div className="space-y-2">
				<h3 className="font-medium">Paquete</h3>
				<Button
					type="button"
					size="sm"
					variant="outline"
					disabled={busy}
					onClick={() => setUploadingZip(true)}
				>
					Subir paquete (zip)…
				</Button>
				<p className="text-muted-foreground">
					Reemplaza el texto y los archivos del borrador. Antes ves qué trae y
					no publica nada.
				</p>
			</div>

			{versions.length > 0 && (
				<div className="space-y-2">
					<h3 className="font-medium">Versiones</h3>
					<ol className="divide-y rounded-md border">
						{versions.map((row) => (
							<li key={row.id} className="space-y-1 px-2 py-1">
								<p>
									{row.action === "publicar"
										? `v${row.version}`
										: `Retirada la v${row.version}`}
									{row.republishedFrom !== null &&
										` (republica la v${row.republishedFrom})`}{" "}
									<span className="text-muted-foreground">
										{row.createdAt.slice(0, 10)}
									</span>
								</p>
								<p className="text-muted-foreground">{row.note}</p>
								{canPublish && row.action === "publicar" && (
									<Button
										type="button"
										size="sm"
										variant="ghost"
										disabled={busy}
										onClick={() => {
											const note = askNote(
												`¿Por qué se republica la v${row.version}? Queda en el registro.`,
											);
											if (!note) return;
											run(
												() =>
													republishSkillAction({
														tenantSlug,
														slug,
														fromVersion: row.version,
														note,
													}),
												"No se pudo republicar.",
											);
										}}
									>
										Republicar
									</Button>
								)}
							</li>
						))}
					</ol>
				</div>
			)}

			{message && <p className="text-destructive">{message}</p>}
			{uploadingZip && (
				<UploadDialog
					tenantSlug={tenantSlug}
					target={{ kind: "skill", slug }}
					onClose={() => setUploadingZip(false)}
				/>
			)}
			{publishing && (
				<PublishDialog
					tenantSlug={tenantSlug}
					slug={slug}
					onClose={() => setPublishing(false)}
				/>
			)}
		</section>
	);
}
