"use client";

import {
	FolderIcon,
	LoaderCircleIcon,
	LockIcon,
	PlusIcon,
	XIcon,
} from "lucide-react";
import { useEffect, useRef, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { ResearchRow } from "@/lib/onboarding/research-store";
import {
	confirmFolders,
	ensureResearch,
	useGenericFolders as genericFolders,
	readResearch,
	retryResearch,
} from "./actions";

const POLL_MS = 2000;
const MAX_FOLDERS = 19;

type Row = {
	id: number;
	name: string;
	description: string;
	restricted: boolean;
};

/** Minúsculas, sin acentos, [a-z0-9-], empieza con letra, hasta 41 caracteres. */
export function slugify(name: string): string {
	return name
		.normalize("NFD")
		.replace(/[̀-ͯ]/g, "")
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^[^a-z]+/, "")
		.slice(0, 41)
		.replace(/-+$/, "");
}

export function CarpetasForm({
	slug,
	displayName,
	domain,
	initial,
}: {
	slug: string;
	displayName: string;
	domain: string;
	initial: ResearchRow | null;
}) {
	const [research, setResearch] = useState<ResearchRow | null>(initial);
	const started = useRef(false);

	const waiting = research === null || research.status === "running";

	// Sin fila (el paso anterior no pudo agendar el research): se pide una vez.
	useEffect(() => {
		if (research !== null || started.current) return;
		started.current = true;
		void ensureResearch(slug);
	}, [research, slug]);

	useEffect(() => {
		if (!waiting) return;
		const timer = setInterval(async () => {
			try {
				const row = await readResearch(slug);
				if (row) setResearch(row);
			} catch {
				// Un tropiezo de red no corta el sondeo: el próximo tick reintenta.
			}
		}, POLL_MS);
		return () => clearInterval(timer);
	}, [waiting, slug]);

	if (waiting) return <Investigando domain={domain} />;
	const found = research.status === "done" && research.result;
	if (found && (research.result?.found || research.hint)) {
		return (
			<Propuesta
				displayName={displayName}
				domain={domain}
				initial={research.result?.folders ?? []}
				slug={slug}
			/>
		);
	}
	return (
		<SinSitio
			domain={domain}
			note={research.status === "error"}
			onRunning={() =>
				setResearch({
					status: "running",
					hint: null,
					result: null,
					error: null,
					updatedAt: new Date().toISOString(),
				})
			}
			onDone={async () => {
				const row = await readResearch(slug);
				if (row) setResearch(row);
			}}
			slug={slug}
		/>
	);
}

function Investigando({ domain }: { domain: string }) {
	return (
		<div className="space-y-4 py-6 text-center">
			<LoaderCircleIcon
				aria-hidden
				className="mx-auto size-8 animate-spin text-primary"
			/>
			<h1 className="text-2xl leading-tight">Estamos leyendo {domain}</h1>
			<p className="mx-auto max-w-[520px] text-muted-foreground text-sm">
				El brain es la memoria de tu empresa: páginas que tu equipo y los
				agentes leen antes de responder. Lo ordenamos en carpetas, y cada
				carpeta decide quién la ve. Tarda unos segundos.
			</p>
		</div>
	);
}

function SinSitio({
	slug,
	domain,
	note,
	onRunning,
	onDone,
}: {
	slug: string;
	domain: string;
	note: boolean;
	onRunning: () => void;
	onDone: () => Promise<void>;
}) {
	const [hint, setHint] = useState("");
	const [error, setError] = useState<string | null>(null);
	const [pending, startTransition] = useTransition();

	function propose() {
		if (!hint.trim()) {
			setError("Con una línea alcanza para empezar.");
			return;
		}
		setError(null);
		startTransition(async () => {
			const result = await retryResearch(slug, hint);
			if (result.ok) onRunning();
			else setError("No pudimos seguir. Probá de nuevo.");
		});
	}

	function generic() {
		setError(null);
		startTransition(async () => {
			const result = await genericFolders(slug);
			if (result.ok) await onDone();
			else setError("No pudimos seguir. Probá de nuevo.");
		});
	}

	return (
		<div className="space-y-5">
			<div className="space-y-2">
				<h1 className="text-2xl leading-tight">
					No encontramos mucho en {domain}
				</h1>
				<p className="text-muted-foreground text-sm">
					Contanos en tres líneas qué hace la empresa y con eso armamos las
					carpetas.
				</p>
				{note ? (
					<p className="text-muted-foreground text-xs">
						No pudimos leer el sitio esta vez.
					</p>
				) : null}
			</div>
			<div className="space-y-2">
				<label className="block text-sm" htmlFor="hint">
					Qué hace tu empresa
				</label>
				<Textarea
					aria-invalid={error ? true : undefined}
					id="hint"
					maxLength={2000}
					onChange={(e) => setHint(e.target.value)}
					placeholder="Molino de trigo en Buenos Aires. Vendemos harina a panaderías e industrias. Somos unas 600 personas en dos plantas."
					rows={4}
					value={hint}
				/>
				{error ? (
					<p className="text-destructive text-sm" role="alert">
						{error}
					</p>
				) : null}
			</div>
			<Button className="w-full" disabled={pending} onClick={propose} size="lg">
				Proponer carpetas
			</Button>
			<div className="text-center">
				<button
					className="text-muted-foreground text-sm underline underline-offset-4 disabled:opacity-50"
					disabled={pending}
					onClick={generic}
					type="button"
				>
					Usar las carpetas genéricas y seguir
				</button>
			</div>
		</div>
	);
}

function Propuesta({
	slug,
	displayName,
	domain,
	initial,
}: {
	slug: string;
	displayName: string;
	domain: string;
	initial: {
		slug: string;
		name: string;
		description: string;
		restricted: boolean;
	}[];
}) {
	const nextId = useRef(initial.length);
	const [rows, setRows] = useState<Row[]>(() =>
		initial.map((f, id) => ({ id, ...f })),
	);
	const [error, setError] = useState<string | null>(null);
	const [pending, startTransition] = useTransition();

	const update = (id: number, patch: Partial<Row>) =>
		setRows((all) => all.map((r) => (r.id === id ? { ...r, ...patch } : r)));

	function add() {
		setRows((all) => [
			...all,
			{ id: nextId.current++, name: "", description: "", restricted: false },
		]);
	}

	function submit() {
		const slugs = rows.map((r) => slugify(r.name));
		if (slugs.some((s) => !s)) {
			setError("Poné un nombre a cada carpeta.");
			return;
		}
		if (new Set(slugs).size !== slugs.length) {
			setError("Hay dos carpetas con el mismo nombre.");
			return;
		}
		setError(null);
		startTransition(async () => {
			// En éxito la acción redirige y no devuelve nada.
			const result = await confirmFolders(
				slug,
				rows.map((r, i) => ({
					slug: slugs[i],
					name: r.name.trim(),
					description: r.description,
					restricted: r.restricted,
				})),
			);
			if (result && !result.ok) setError(result.message);
		});
	}

	return (
		<div className="space-y-5">
			<div className="space-y-2">
				<h1 className="text-2xl leading-tight">
					Así ordenaríamos el brain de {displayName}
				</h1>
				<p className="text-muted-foreground text-sm">
					Leímos {domain} y propusimos estas carpetas. Cambiá lo que quieras:
					nombres, cuáles quedan y quién las ve.
				</p>
			</div>
			<ul className="space-y-2">
				{rows.map((row) => (
					<li
						className="flex items-start gap-3 rounded-lg border p-3"
						key={row.id}
					>
						{row.restricted ? (
							<LockIcon
								aria-hidden
								className="mt-2 size-4 shrink-0 text-primary"
							/>
						) : (
							<FolderIcon
								aria-hidden
								className="mt-2 size-4 shrink-0 text-muted-foreground"
							/>
						)}
						<div className="min-w-0 flex-1 space-y-1">
							<Input
								aria-label="Nombre de la carpeta"
								maxLength={60}
								onChange={(e) => update(row.id, { name: e.target.value })}
								value={row.name}
							/>
							{row.description ? (
								<p className="text-muted-foreground text-xs">
									{row.description}
								</p>
							) : null}
						</div>
						<select
							aria-label="Quién la ve"
							className="h-9 rounded-md border border-input bg-card px-2 text-sm"
							onChange={(e) =>
								update(row.id, { restricted: e.target.value === "restringida" })
							}
							value={row.restricted ? "restringida" : "abierta"}
						>
							<option value="abierta">Abierta</option>
							<option value="restringida">Restringida</option>
						</select>
						<button
							aria-label="Quitar la carpeta"
							className="mt-2 text-muted-foreground hover:text-foreground disabled:opacity-40"
							disabled={rows.length <= 1}
							onClick={() =>
								setRows((all) => all.filter((r) => r.id !== row.id))
							}
							type="button"
						>
							<XIcon aria-hidden className="size-4" />
						</button>
					</li>
				))}
			</ul>
			<button
				className="inline-flex items-center gap-1 text-primary text-sm disabled:opacity-50"
				disabled={rows.length >= MAX_FOLDERS}
				onClick={add}
				type="button"
			>
				<PlusIcon aria-hidden className="size-4" />
				Agregar una carpeta
			</button>
			<p className="flex items-start gap-2 text-muted-foreground text-xs">
				<LockIcon aria-hidden className="mt-0.5 size-3.5 shrink-0" />
				Las carpetas abiertas las lee todo el equipo. Las restringidas, solo vos
				y a quien invites a esa carpeta. Las invitaciones y los permisos se
				manejan después desde Configuración.
			</p>
			{error ? (
				<p className="text-destructive text-sm" role="alert">
					{error}
				</p>
			) : null}
			<Button className="w-full" disabled={pending} onClick={submit} size="lg">
				Crear estas carpetas
			</Button>
		</div>
	);
}
