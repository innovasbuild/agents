"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { BrainMarkdown, type PageLookup } from "@/components/brain/markdown";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { diffLines } from "@/lib/brain/diff";
import {
	insertWikilink,
	wikilinkQueryAt,
} from "@/lib/brain/editor/autocomplete";
import type { SavePageResult } from "@/lib/brain/editor/save";
import { pageHref } from "@/lib/brain/editor/slug";
import {
	BRAIN_STATUSES,
	type BrainStatus,
	CANON_TAGS,
} from "@/lib/brain/types";
import { saveBrainPage } from "./actions";

export interface PageFormInitial {
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
const MAX_SUGGESTIONS = 8;

export function PageForm({
	mode,
	tenantSlug,
	categories,
	knownTags,
	pages,
	initial,
}: {
	mode: "edit" | "new";
	tenantSlug: string;
	categories: string[];
	knownTags: string[];
	pages: { slug: string; title: string; status: BrainStatus }[];
	initial: PageFormInitial;
}) {
	const router = useRouter();
	const [form, setForm] = useState(initial);
	const [tagsText, setTagsText] = useState(initial.tags.join(", "));
	const [reason, setReason] = useState("");
	const [baseRevision, setBaseRevision] = useState(initial.revision);
	const [result, setResult] = useState<SavePageResult | null>(null);
	const [serverBody, setServerBody] = useState<string | null>(null);
	const [query, setQuery] = useState<{ start: number; query: string } | null>(
		null,
	);
	const [isPending, startTransition] = useTransition();
	const bodyRef = useRef<HTMLTextAreaElement>(null);

	const tags = tagsText
		.split(",")
		.map((t) => t.trim())
		.filter(Boolean);
	const dirty =
		form.title !== initial.title ||
		form.category !== initial.category ||
		form.status !== initial.status ||
		form.body !== initial.body ||
		form.slug !== initial.slug ||
		tags.join(",") !== initial.tags.join(",");

	useEffect(() => {
		if (!dirty) return;
		const warn = (event: BeforeUnloadEvent) => event.preventDefault();
		window.addEventListener("beforeunload", warn);
		return () => window.removeEventListener("beforeunload", warn);
	}, [dirty]);

	const lookup: PageLookup = useMemo(
		() =>
			new Map(pages.map((p) => [p.slug, { title: p.title, status: p.status }])),
		[pages],
	);
	const suggestions = query
		? pages
				.filter((p) =>
					`${p.slug} ${p.title}`
						.toLowerCase()
						.includes(query.query.toLowerCase()),
				)
				.slice(0, MAX_SUGGESTIONS)
		: [];
	const fieldError = (field: string) =>
		result &&
		!result.ok &&
		result.code === "validation" &&
		result.fields.some((f) => f === field || f.startsWith(`${field}.`));

	function onBodyChange(value: string, cursor: number) {
		setForm((f) => ({ ...f, body: value }));
		setQuery(wikilinkQueryAt(value, cursor));
	}

	function pick(slug: string, title: string) {
		if (!query || !bodyRef.current) return;
		const next = insertWikilink(
			form.body,
			query.start,
			bodyRef.current.selectionStart,
			slug,
			title,
		);
		setForm((f) => ({ ...f, body: next.text }));
		setQuery(null);
		requestAnimationFrame(() => {
			bodyRef.current?.focus();
			bodyRef.current?.setSelectionRange(next.cursor, next.cursor);
		});
	}

	function submit(event: React.FormEvent) {
		event.preventDefault();
		startTransition(async () => {
			const saved = await saveBrainPage({
				tenantSlug,
				slug: form.slug,
				title: form.title,
				category: form.category,
				status: form.status,
				tags,
				frontmatter: form.frontmatter,
				body: form.body,
				reason,
				baseRevision,
			});
			setResult(saved);
			if (saved.ok) {
				router.push(pageHref(tenantSlug, saved.slug));
				return;
			}
			if (saved.code === "conflict" && saved.currentRevision !== null) {
				// Se trae la vigente para mostrar el diff; el texto del usuario queda.
				const response = await fetch(`/${tenantSlug}/brain/raw/${form.slug}`, {
					cache: "no-store",
				});
				setServerBody(response.ok ? await response.text() : null);
			}
		});
	}

	return (
		<form onSubmit={submit} className="max-w-4xl space-y-5">
			{result && !result.ok && (
				<div
					role="alert"
					className="rounded-lg border border-destructive/50 bg-destructive/5 p-4 text-sm"
				>
					<p className="font-medium">{result.message}</p>
					{result.code === "conflict" && result.currentRevision !== null && (
						<div className="mt-3 space-y-3">
							<p>
								Tu texto sigue acá. Mirá qué cambió y, si querés guardar igual,
								reintentá sobre la revisión {result.currentRevision}.
							</p>
							{serverBody !== null && (
								<details open>
									<summary className="cursor-pointer">
										Diferencias entre la vigente y tu versión
									</summary>
									<pre className="mt-2 max-h-80 overflow-auto rounded bg-muted p-3 text-xs">
										{diffLines(serverBody, form.body).map((block, i) =>
											block.lines.map((line, j) => (
												// biome-ignore lint/suspicious/noArrayIndexKey: bloques de diff sin id estable
												<div
													key={`${i}-${j}`}
													className={
														block.kind === "added"
															? "bg-green-500/15"
															: block.kind === "removed"
																? "bg-red-500/15"
																: ""
													}
												>
													{block.kind === "added"
														? "+ "
														: block.kind === "removed"
															? "- "
															: "  "}
													{line}
												</div>
											)),
										)}
									</pre>
								</details>
							)}
							<Button
								type="button"
								variant="outline"
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

			<div className="grid gap-4 sm:grid-cols-2">
				<label className="space-y-1 text-sm sm:col-span-2">
					<span>Slug</span>
					<Input
						value={form.slug}
						readOnly={mode === "edit"}
						aria-invalid={!!fieldError("slug")}
						onChange={(e) =>
							setForm((f) => ({
								...f,
								slug: e.target.value.trim().toLowerCase(),
							}))
						}
						placeholder="comercial/nueva-pagina"
					/>
				</label>
				<label className="space-y-1 text-sm sm:col-span-2">
					<span>Título</span>
					<Input
						value={form.title}
						aria-invalid={!!fieldError("title")}
						onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
					/>
				</label>
				<label className="space-y-1 text-sm">
					<span>Categoría</span>
					<select
						className="h-9 w-full rounded-md border bg-background px-3"
						value={form.category}
						aria-invalid={!!fieldError("category")}
						onChange={(e) =>
							setForm((f) => ({ ...f, category: e.target.value }))
						}
					>
						{categories.map((c) => (
							<option key={c} value={c}>
								{c}
							</option>
						))}
					</select>
				</label>
				<label className="space-y-1 text-sm">
					<span>Estado</span>
					<select
						className="h-9 w-full rounded-md border bg-background px-3"
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
				<label className="space-y-1 text-sm sm:col-span-2">
					<span>Tags, separados por coma</span>
					<Input
						value={tagsText}
						list="brain-tags"
						aria-invalid={!!fieldError("tags")}
						onChange={(e) => setTagsText(e.target.value)}
					/>
					<datalist id="brain-tags">
						{[...new Set([...CANON_TAGS, ...knownTags])].map((t) => (
							<option key={t} value={t} />
						))}
					</datalist>
				</label>
			</div>

			<Tabs defaultValue="editar">
				<TabsList>
					<TabsTrigger value="editar">Editar</TabsTrigger>
					<TabsTrigger value="vista">Vista previa</TabsTrigger>
				</TabsList>
				<TabsContent value="editar" className="relative">
					<Textarea
						ref={bodyRef}
						value={form.body}
						rows={24}
						className="font-mono text-sm"
						aria-invalid={!!fieldError("body")}
						onChange={(e) =>
							onBodyChange(e.target.value, e.target.selectionStart)
						}
						onKeyDown={(e) => {
							if (e.key === "Escape") setQuery(null);
						}}
					/>
					{suggestions.length > 0 && (
						<ul className="absolute right-2 bottom-2 left-2 z-10 max-h-60 overflow-auto rounded-md border bg-popover text-sm shadow-md">
							{suggestions.map((p) => (
								<li key={p.slug}>
									<button
										type="button"
										className="flex w-full flex-col items-start px-3 py-2 text-left hover:bg-muted"
										onClick={() => pick(p.slug, p.title)}
									>
										<span>{p.title}</span>
										<span className="text-muted-foreground text-xs">
											{p.slug}
										</span>
									</button>
								</li>
							))}
						</ul>
					)}
				</TabsContent>
				<TabsContent value="vista">
					<div className="min-h-40 rounded-md border p-4">
						<BrainMarkdown
							body={form.body}
							tenantSlug={tenantSlug}
							pages={lookup}
						/>
					</div>
				</TabsContent>
			</Tabs>

			<label className="block space-y-1 text-sm">
				<span>Motivo del cambio (queda en el historial)</span>
				<Input
					value={reason}
					required
					aria-invalid={!!fieldError("reason")}
					onChange={(e) => setReason(e.target.value)}
					placeholder="Ej.: actualizo precios del Radar"
				/>
			</label>

			<div className="flex gap-3">
				<Button type="submit" size="lg" disabled={isPending || !reason.trim()}>
					{isPending ? "Guardando…" : "Guardar"}
				</Button>
				<Button
					type="button"
					size="lg"
					variant="ghost"
					onClick={() => router.back()}
				>
					Cancelar
				</Button>
			</div>
		</form>
	);
}
