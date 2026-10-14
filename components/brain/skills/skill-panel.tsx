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
import { skillFileHref } from "@/lib/brain/core/skills/http";
import type { SkillFile } from "@/lib/brain/core/skills/package";
import {
	type SkillState,
	skillStateLabel,
} from "@/lib/brain/core/skills/state";
import { PublishDialog } from "./publish-dialog";
import { formatSize } from "./published-files";

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
	const fileInput = useRef<HTMLInputElement>(null);
	const zipInput = useRef<HTMLInputElement>(null);
	const [path, setPath] = useState("");
	const [message, setMessage] = useState<string | null>(null);
	const [publishing, setPublishing] = useState(false);
	const [isPending, startTransition] = useTransition();

	const endpoint = `/${tenantSlug}/brain/skills/files`;
	const publishable = state.kind !== "publicada" || state.dirty;

	async function upload(form: FormData) {
		setMessage(null);
		try {
			const response = await fetch(endpoint, { method: "POST", body: form });
			const result = (await response.json()) as {
				ok: boolean;
				message?: string;
			};
			if (!result.ok) {
				setMessage(result.message ?? "No se pudo subir.");
				return;
			}
			setPath("");
			if (fileInput.current) fileInput.current.value = "";
			if (zipInput.current) zipInput.current.value = "";
			router.refresh();
		} catch {
			setMessage("No se pudo subir. Probá de nuevo.");
		}
	}

	function uploadFile() {
		const file = fileInput.current?.files?.[0];
		if (!file) {
			setMessage("Elegí un archivo.");
			return;
		}
		const form = new FormData();
		form.set("slug", slug);
		form.set("path", path.trim() || file.name);
		form.set("file", file);
		startTransition(() => upload(form));
	}

	function importZip() {
		const file = zipInput.current?.files?.[0];
		if (!file) {
			setMessage("Elegí un zip.");
			return;
		}
		if (
			!window.confirm(
				"Importar reemplaza el texto y los archivos del borrador por los del paquete. No publica nada.",
			)
		)
			return;
		const form = new FormData();
		form.set("slug", slug);
		form.set("kind", "zip");
		form.set("file", file);
		startTransition(() => upload(form));
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
				{canPublish ? (
					<div className="flex flex-wrap gap-2">
						{publishable && (
							<Button
								type="button"
								size="sm"
								disabled={isPending}
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
								disabled={isPending}
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

				<label htmlFor={pathId} className="block space-y-1">
					<span>Ruta dentro del paquete</span>
					<Input
						id={pathId}
						value={path}
						placeholder="scripts/calcular.py"
						onChange={(e) => setPath(e.target.value)}
					/>
				</label>
				<input ref={fileInput} type="file" aria-label="Archivo a subir" />
				<Button
					type="button"
					size="sm"
					variant="outline"
					disabled={isPending}
					onClick={uploadFile}
				>
					Subir archivo
				</Button>
				<p className="text-muted-foreground">
					Hasta 4 MB por archivo, 50 archivos y 20 MB en total. Si la ruta queda
					vacía se usa el nombre del archivo.
				</p>
			</div>

			<div className="space-y-2">
				<h3 className="font-medium">Importar un paquete</h3>
				<input
					ref={zipInput}
					type="file"
					accept=".zip,application/zip"
					aria-label="Zip del paquete"
				/>
				<Button
					type="button"
					size="sm"
					variant="outline"
					disabled={isPending}
					onClick={importZip}
				>
					Importar zip
				</Button>
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
										disabled={isPending}
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
