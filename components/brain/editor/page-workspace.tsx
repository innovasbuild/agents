"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
	type FormEvent,
	type ReactNode,
	useEffect,
	useId,
	useMemo,
	useState,
	useTransition,
} from "react";
import { saveBrainPage } from "@/app/[tenant]/brain/actions";
import { DeletePageButton } from "@/components/brain/delete-page-button";
import { DetailsSheet } from "@/components/brain/details-sheet";
import { DiffView } from "@/components/brain/diff-view";
import { Paper } from "@/components/brain/paper";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { diffLines } from "@/lib/brain/core/diff";
import { chooseBodyToSave } from "@/lib/brain/core/editor/body-to-save";
import type { SavePageResult } from "@/lib/brain/core/editor/save";
import { historyHref, pageHref } from "@/lib/brain/core/editor/slug";
import {
	BRAIN_STATUSES,
	type BrainStatus,
	CANON_TAGS,
} from "@/lib/brain/core/types";

// Carga diferida: quien llega a la vista de lectura no baja Tiptap.
const MarkdownEditor = dynamic(
	() => import("./markdown-editor").then((m) => m.MarkdownEditor),
	{ ssr: false, loading: () => <div className="h-11 lg:h-10" aria-hidden /> },
);

export interface WorkspaceInitial {
	slug: string;
	title: string;
	category: string;
	status: BrainStatus;
	tags: string[];
	frontmatter: Record<string, unknown>;
	body: string;
	revision: number | null; // null en una página nueva
}

const STATUS_LABEL = {
	activo: "Activo",
	borrador: "Borrador",
	archivado: "Archivado",
} as const;

export interface PageWorkspaceProps {
	mode: "edit" | "new";
	tenantSlug: string;
	categories: string[];
	knownTags: string[];
	pages: Array<{ slug: string; title: string; status: BrainStatus }>;
	initial: WorkspaceInitial;
	// Datos y conexiones, ya armados en el servidor (solo modo edit).
	facts?: ReactNode;
	canDelete?: boolean;
}

export function PageWorkspace({
	mode,
	tenantSlug,
	categories,
	knownTags,
	pages,
	initial,
	facts,
	canDelete,
}: PageWorkspaceProps) {
	const router = useRouter();
	const tagsId = useId();
	const slugId = useId();
	// `saved` es el último estado guardado de los campos (para detectar cambios).
	const [saved, setSaved] = useState(initial);
	const [form, setForm] = useState(initial);
	const [tagsText, setTagsText] = useState(initial.tags.join(", "));
	// Cuerpo: el original cargado, lo que serializó el editor al cargarlo
	// (`baseline`) y lo último que informó (`serialized`). Spec 18.2 V6.
	const [original, setOriginal] = useState(initial.body);
	const [baseline, setBaseline] = useState<string | null>(null);
	const [serialized, setSerialized] = useState(initial.body);
	const [reason, setReason] = useState("");
	const [baseRevision, setBaseRevision] = useState(initial.revision);
	const [result, setResult] = useState<SavePageResult | null>(null);
	const [serverBody, setServerBody] = useState<string | null>(null);
	const [editorKey, setEditorKey] = useState(0);
	const [isPending, startTransition] = useTransition();

	const body = useMemo(
		() =>
			chooseBodyToSave({
				original,
				originalRoundtrip: baseline ?? original,
				serialized,
			}),
		[original, baseline, serialized],
	);
	const tags = useMemo(
		() =>
			tagsText
				.split(",")
				.map((tag) => tag.trim())
				.filter(Boolean),
		[tagsText],
	);
	const dirty =
		form.title !== saved.title ||
		form.category !== saved.category ||
		form.status !== saved.status ||
		form.slug !== saved.slug ||
		tags.join(",") !== saved.tags.join(",") ||
		body !== original;

	useEffect(() => {
		if (!dirty) return;
		const warn = (event: BeforeUnloadEvent) => event.preventDefault();
		window.addEventListener("beforeunload", warn);
		return () => window.removeEventListener("beforeunload", warn);
	}, [dirty]);

	const fieldError = (field: string) =>
		result &&
		!result.ok &&
		result.code === "validation" &&
		result.fields.some((f) => f === field || f.startsWith(`${field}.`));

	function submit(event: FormEvent) {
		event.preventDefault();
		startTransition(async () => {
			try {
				const sentReason = reason;
				const outcome = await saveBrainPage({
					tenantSlug,
					slug: form.slug,
					title: form.title,
					category: form.category,
					status: form.status,
					tags,
					frontmatter: form.frontmatter,
					body,
					reason: sentReason,
					baseRevision,
				});
				setResult(outcome);
				if (outcome.ok) {
					if (mode === "new") {
						router.replace(pageHref(tenantSlug, outcome.slug));
						return;
					}
					// Sigue en edición sobre la revisión nueva. Si el cuerpo cambió, el
					// nuevo original es lo guardado; `serialized` no se toca: si la persona
					// siguió escribiendo durante el guardado, conserva lo más nuevo. Si solo
					// cambiaron metadatos, el original y la línea de base quedan.
					if (body !== original) setBaseline(body);
					setOriginal(body);
					setSaved({ ...form, tags, body, revision: outcome.revision });
					setBaseRevision(outcome.revision);
					// No borra un motivo escrito mientras se guardaba.
					setReason((current) => (current === sentReason ? "" : current));
					setResult(null);
					setServerBody(null);
					router.refresh();
					return;
				}
				if (outcome.code === "conflict" && outcome.currentRevision !== null) {
					// Se trae la vigente para mostrar el diff; el texto de la persona queda.
					try {
						const response = await fetch(
							`/${tenantSlug}/brain/raw/${form.slug}`,
							{ cache: "no-store" },
						);
						setServerBody(response.ok ? await response.text() : null);
					} catch {
						setServerBody(null);
					}
				}
			} catch {
				setResult({
					ok: false,
					code: "internal",
					message: "No se pudo guardar. Revisá la conexión y reintentá.",
				});
			}
		});
	}

	function discard() {
		setForm(saved);
		setTagsText(saved.tags.join(", "));
		setReason("");
		setResult(null);
		setServerBody(null);
		// Remonta el editor: vuelve a cargar el cuerpo original y avisa su línea de base.
		setEditorKey((key) => key + 1);
	}

	const detailsFields = (
		<div className="space-y-4 text-sm">
			<label className="block space-y-1">
				<span>Categoría</span>
				<select
					className="h-11 w-full rounded-md border bg-background px-3 lg:h-9"
					value={form.category}
					aria-invalid={!!fieldError("category")}
					onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}
				>
					{categories.map((c) => (
						<option key={c} value={c}>
							{c}
						</option>
					))}
				</select>
			</label>
			<label className="block space-y-1">
				<span>Estado</span>
				<select
					className="h-11 w-full rounded-md border bg-background px-3 lg:h-9"
					value={form.status}
					onChange={(e) =>
						setForm((f) => ({ ...f, status: e.target.value as BrainStatus }))
					}
				>
					{BRAIN_STATUSES.map((s) => (
						<option key={s} value={s}>
							{STATUS_LABEL[s]}
						</option>
					))}
				</select>
			</label>
			<label htmlFor={tagsId} className="block space-y-1">
				<span>Tags, separados por coma</span>
				<Input
					id={tagsId}
					value={tagsText}
					list="brain-tags"
					className="min-h-11 lg:min-h-9"
					aria-invalid={!!fieldError("tags")}
					onChange={(e) => setTagsText(e.target.value)}
				/>
				<datalist id="brain-tags">
					{[...new Set([...CANON_TAGS, ...knownTags])].map((tag) => (
						<option key={tag} value={tag} />
					))}
				</datalist>
			</label>
			{mode === "edit" && (
				<>
					<p className="text-muted-foreground">
						Slug: <code className="break-all">{form.slug}</code>
					</p>
					{facts}
					{canDelete && (
						<DeletePageButton
							tenantSlug={tenantSlug}
							slug={form.slug}
							title={form.title}
						/>
					)}
				</>
			)}
		</div>
	);

	return (
		<form onSubmit={submit} className="space-y-4 pb-48">
			<div className="flex flex-wrap items-center gap-3">
				<Link
					href={`/${tenantSlug}/brain`}
					className="mr-auto inline-flex min-h-11 items-center text-muted-foreground text-sm lg:min-h-0"
				>
					← Brain · <span className="capitalize">{form.category}</span>
				</Link>
				{mode === "edit" && (
					<Button asChild variant="outline" className="min-h-11 lg:min-h-0">
						<Link href={historyHref(tenantSlug, form.slug)}>Historial</Link>
					</Button>
				)}
				<DetailsSheet
					title={mode === "edit" ? "Detalles" : "Datos de la página"}
				>
					{detailsFields}
				</DetailsSheet>
			</div>

			<Paper>
				{mode === "new" && (
					<label htmlFor={slugId} className="mb-4 block space-y-1 text-sm">
						<span>Slug</span>
						<Input
							id={slugId}
							value={form.slug}
							aria-invalid={!!fieldError("slug")}
							className="min-h-11 lg:min-h-9"
							placeholder="comercial/nueva-pagina"
							onChange={(e) =>
								setForm((f) => ({
									...f,
									slug: e.target.value.trim().toLowerCase(),
								}))
							}
						/>
					</label>
				)}
				<input
					value={form.title}
					aria-label="Título"
					aria-invalid={!!fieldError("title")}
					placeholder="Título"
					className="mb-6 w-full bg-transparent font-semibold text-3xl leading-tight outline-none placeholder:text-muted-foreground aria-invalid:text-destructive"
					onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
				/>
				<MarkdownEditor
					key={editorKey}
					tenantSlug={tenantSlug}
					initialMarkdown={original}
					value={body}
					pages={pages}
					invalid={!!fieldError("body")}
					onBaseline={(markdown) => {
						setBaseline(markdown);
						setSerialized(markdown);
					}}
					onChange={setSerialized}
				/>
			</Paper>

			{(dirty || (result && !result.ok)) && (
				<div className="fixed inset-x-0 bottom-0 z-20 border-t bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur">
					<div className="mx-auto max-w-3xl space-y-2 p-3">
						{result && !result.ok && (
							<div
								role="alert"
								className="max-h-[50vh] overflow-y-auto rounded-lg border border-destructive/50 bg-destructive/5 p-3 text-sm"
							>
								<p className="font-medium">{result.message}</p>
								{/* mode !== "new": reintentar una creación no tiene una revisión
								    propia contra la cual apoyarse; save.ts ya fuerza
								    currentRevision a null en ese caso, esto es una segunda
								    barrera contra pisar otra página. */}
								{mode !== "new" &&
									result.code === "conflict" &&
									result.currentRevision !== null && (
										<div className="mt-2 space-y-2">
											<p>
												Tu texto sigue acá. Mirá qué cambió y, si querés guardar
												igual, reintentá sobre la revisión{" "}
												{result.currentRevision}.
											</p>
											{serverBody !== null && (
												<details open>
													<summary className="cursor-pointer">
														Diferencias entre la vigente y tu versión
													</summary>
													<div className="mt-2">
														<DiffView blocks={diffLines(serverBody, body)} />
													</div>
												</details>
											)}
											<Button
												type="button"
												variant="outline"
												className="min-h-11"
												onClick={() => {
													setBaseRevision(result.currentRevision);
													setResult(null);
												}}
											>
												Reintentar sobre la revisión {result.currentRevision}
											</Button>
										</div>
									)}
							</div>
						)}
						<div className="flex flex-wrap items-center gap-2">
							<Input
								value={reason}
								aria-label="Motivo del cambio"
								placeholder="Motivo (opcional): qué cambiaste"
								className="min-h-11 min-w-0 flex-1 lg:min-h-9"
								onChange={(e) => setReason(e.target.value)}
							/>
							<Button
								type="button"
								variant="ghost"
								className="min-h-11"
								disabled={isPending}
								onClick={discard}
							>
								Descartar
							</Button>
							<Button
								type="submit"
								className="min-h-11"
								disabled={isPending || !dirty}
							>
								{isPending ? "Guardando…" : "Guardar"}
							</Button>
						</div>
					</div>
				</div>
			)}
		</form>
	);
}
