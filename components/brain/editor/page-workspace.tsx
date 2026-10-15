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
import { ReservedNoticeBox } from "@/components/brain/reserved-notice";
import { RulesPanel, useFolderRules } from "@/components/brain/rules-panel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { diffLines } from "@/lib/brain/core/diff";
import { chooseBodyToSave } from "@/lib/brain/core/editor/body-to-save";
import { reservedNotice } from "@/lib/brain/core/editor/reserved";
import type { RulesPanelView } from "@/lib/brain/core/editor/rules-panel";
import type { SavePageResult } from "@/lib/brain/core/editor/save";
import { historyHref, pageHref } from "@/lib/brain/core/editor/slug";
import {
	MAX_COMPATIBILITY,
	MAX_DESCRIPTION,
	SKILL_CATEGORY,
} from "@/lib/brain/core/skills/package";
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

// Serialización con las claves ordenadas: el orden de las claves no es un cambio.
function stableJson(value: unknown): string {
	return JSON.stringify(value, (_key, v) =>
		v && typeof v === "object" && !Array.isArray(v)
			? Object.fromEntries(
					Object.entries(v).sort(([a], [b]) => a.localeCompare(b)),
				)
			: v,
	);
}

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
	// Panel de la skill (estado, archivos, versiones), ya armado en el servidor.
	skill?: ReactNode;
	// Reglas que aplican, ya armadas en el servidor (spec etapa 26 §4.3). null:
	// la ruta no tiene, no se ven o es de skills.
	rules?: RulesPanelView | null;
	// Página nueva con el slug ya decidido (las reglas de una carpeta).
	slugLocked?: boolean;
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
	skill,
	rules,
	slugLocked = false,
}: PageWorkspaceProps) {
	const router = useRouter();
	const tagsId = useId();
	const slugId = useId();
	const descriptionId = useId();
	const compatibilityId = useId();
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
	// En una página nueva el panel sigue a la carpeta que se escribe en el slug.
	const rulesView = useFolderRules({
		enabled: mode === "new" && !slugLocked,
		tenantSlug,
		slug: form.slug,
		initial: rules ?? null,
	});
	// Una reservada avisa qué gobierna y cuenta caracteres (spec etapa 26 §4.1).
	const notice = reservedNotice(form.slug);

	const isSkill = form.category === SKILL_CATEGORY;
	const frontmatterText = (key: string) =>
		typeof form.frontmatter[key] === "string"
			? (form.frontmatter[key] as string)
			: "";
	// Un campo vacío se saca del frontmatter en vez de guardarse como "".
	const setFrontmatterText = (key: string, value: string) =>
		setForm((f) => {
			const next = { ...f.frontmatter };
			if (value.length > 0) next[key] = value;
			else delete next[key];
			return { ...f, frontmatter: next };
		});

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
		stableJson(form.frontmatter) !== stableJson(saved.frontmatter) ||
		tags.join(",") !== saved.tags.join(",") ||
		body !== original;

	// El servidor cambió la página por otro camino (importar un zip, otra
	// persona): si no hay cambios sin guardar, el editor vuelve a cargarla. Tras
	// un guardado propio `baseRevision` ya es la revisión nueva y no hace nada.
	// biome-ignore lint/correctness/useExhaustiveDependencies: solo reacciona a una revisión nueva del servidor
	useEffect(() => {
		if (mode !== "edit" || initial.revision === null) return;
		if (initial.revision === baseRevision || dirty) return;
		setSaved(initial);
		setForm(initial);
		setTagsText(initial.tags.join(", "));
		setOriginal(initial.body);
		setBaseline(null);
		setSerialized(initial.body);
		setBaseRevision(initial.revision);
		setReason("");
		setResult(null);
		setServerBody(null);
		setEditorKey((key) => key + 1);
	}, [initial.revision]);

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
			{/* La categoría de una reservada la pone el proveedor según la ruta; elegir
			    skill acá la forzaría a Activo al guardar. */}
			{!notice && (
				<label className="block space-y-1">
					<span>Categoría</span>
					<select
						className="h-11 w-full rounded-md border bg-background px-3 lg:h-9"
						value={form.category}
						disabled={mode === "edit" && isSkill}
						aria-invalid={!!fieldError("category")}
						onChange={(e) =>
							setForm((f) => {
								// Una skill lleva descripción y requisitos; otra categoría no.
								const {
									description: _d,
									compatibility: _c,
									...rest
								} = f.frontmatter;
								return {
									...f,
									category: e.target.value,
									frontmatter:
										f.category === SKILL_CATEGORY &&
										e.target.value !== SKILL_CATEGORY
											? rest
											: f.frontmatter,
								};
							})
						}
					>
						{categories
							.filter((c) => mode === "new" || isSkill || c !== SKILL_CATEGORY)
							.map((c) => (
								<option key={c} value={c}>
									{c}
								</option>
							))}
					</select>
				</label>
			)}
			{!isSkill && (
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
			)}
			{isSkill && (
				<>
					<label htmlFor={descriptionId} className="block space-y-1">
						<span>Descripción: cuándo usar esta skill</span>
						<Textarea
							id={descriptionId}
							value={frontmatterText("description")}
							maxLength={MAX_DESCRIPTION}
							rows={4}
							placeholder="Usar cuando alguien pide emitir o revisar una factura."
							onChange={(e) =>
								setFrontmatterText("description", e.target.value)
							}
						/>
						<span className="text-muted-foreground">
							Es lo que lee el asistente para decidir si la carga. Sin esto no
							se puede publicar.
						</span>
					</label>
					<label htmlFor={compatibilityId} className="block space-y-1">
						<span>Qué necesita (opcional)</span>
						<Input
							id={compatibilityId}
							value={frontmatterText("compatibility")}
							maxLength={MAX_COMPATIBILITY}
							className="min-h-11 lg:min-h-9"
							placeholder="Python 3 con openpyxl"
							onChange={(e) =>
								setFrontmatterText("compatibility", e.target.value)
							}
						/>
					</label>
					{mode === "new" && (
						<p className="text-muted-foreground">
							La ruta de una skill empieza con <code>skills/</code>.
						</p>
					)}
				</>
			)}
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
					{skill}
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

			{notice && <ReservedNoticeBox notice={notice} length={body.length} />}
			{rulesView && (
				<RulesPanel tenantSlug={tenantSlug} view={rulesView} pages={pages} />
			)}
			<Paper>
				{mode === "new" && (
					<label htmlFor={slugId} className="mb-4 block space-y-1 text-sm">
						<span>Slug</span>
						<Input
							id={slugId}
							value={form.slug}
							readOnly={slugLocked}
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
