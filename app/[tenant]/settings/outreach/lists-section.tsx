// app/[tenant]/settings/outreach/lists-section.tsx
"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import type { ListValueRow } from "@/lib/outreach/outreach-settings-query";
import type { ConfigResult } from "../action-helpers";
import { type Feedback, runRowAction } from "../usuarios/run-row-action";
import { rereadMarco, saveListValue } from "./actions";

/** Corre una acción de settings y devuelve qué mostrar. */
function useAction() {
	const router = useRouter();
	const [pending, startTransition] = useTransition();
	const [feedback, setFeedback] = useState<Feedback>(null);
	const run = (action: () => Promise<ConfigResult>, onFail?: () => void) => {
		setFeedback(null);
		startTransition(async () => {
			const out = await runRowAction({
				run: action,
				confirm: () => true,
				refresh: () => router.refresh(),
			});
			if (out.failed) onFail?.();
			setFeedback(
				out.feedback ?? (out.failed ? null : { ok: true, text: "Guardado." }),
			);
		});
	};
	return { pending, feedback, run };
}

export function Message({ feedback }: { feedback: Feedback }) {
	if (!feedback) return null;
	return (
		<span
			className={
				feedback.ok
					? "text-muted-foreground text-xs"
					: "text-destructive text-xs"
			}
			role={feedback.ok ? "status" : "alert"}
		>
			{feedback.text}
		</span>
	);
}

export function RereadButton({ slug }: { slug: string }) {
	const { pending, feedback, run } = useAction();
	return (
		<span className="inline-flex flex-wrap items-center gap-2">
			<Button
				disabled={pending}
				onClick={() => run(() => rereadMarco(slug))}
				size="sm"
				type="button"
				variant="outline"
			>
				Releer del brain
			</Button>
			<Message feedback={feedback} />
		</span>
	);
}

const INPUT = "h-9 rounded-md border border-input bg-transparent px-2 text-sm";

function ValueRow({ slug, row }: { slug: string; row: ListValueRow }) {
	const { pending, feedback, run } = useAction();
	const [label, setLabel] = useState(row.label);
	const [active, setActive] = useState(row.active);

	return (
		<li className="flex flex-wrap items-center gap-3 px-4 py-3">
			<input
				aria-label={`Rótulo de ${row.value}`}
				className={`${INPUT} min-w-0 flex-1`}
				disabled={pending}
				maxLength={200}
				onChange={(event) => setLabel(event.target.value)}
				value={label}
			/>
			<span className="font-mono text-muted-foreground text-xs">
				{row.value}
			</span>
			{active ? null : (
				<span className="text-muted-foreground text-xs">Desactivado</span>
			)}
			<Message feedback={feedback} />
			<Button
				disabled={pending || label.trim() === "" || label === row.label}
				onClick={() =>
					run(() => saveListValue(slug, row.kind, row.value, label, active))
				}
				size="sm"
				type="button"
				variant="outline"
			>
				Guardar
			</Button>
			<Button
				disabled={pending}
				onClick={() => {
					const next = !active;
					setActive(next);
					// Si la base lo rechaza (el último activo), vuelve a como estaba.
					run(
						() => saveListValue(slug, row.kind, row.value, row.label, next),
						() => setActive(!next),
					);
				}}
				size="sm"
				type="button"
				variant="outline"
			>
				{active ? "Desactivar" : "Activar"}
			</Button>
		</li>
	);
}

function AddSegment({ slug }: { slug: string }) {
	const { pending, feedback, run } = useAction();
	const [value, setValue] = useState("");
	const [label, setLabel] = useState("");
	return (
		<form
			className="flex flex-wrap items-center gap-3"
			onSubmit={(event) => {
				event.preventDefault();
				run(() => saveListValue(slug, "segmento", value, label, true));
			}}
		>
			<input
				aria-label="Identificador del segmento"
				className={INPUT}
				disabled={pending}
				onChange={(event) => setValue(event.target.value)}
				pattern="[a-z0-9][a-z0-9_]{0,60}"
				placeholder="identificador_sin_espacios"
				required
				value={value}
			/>
			<input
				aria-label="Rótulo del segmento"
				className={`${INPUT} min-w-0 flex-1`}
				disabled={pending}
				maxLength={200}
				onChange={(event) => setLabel(event.target.value)}
				placeholder="Cómo se muestra"
				required
				value={label}
			/>
			<Button disabled={pending} size="sm" type="submit">
				Agregar segmento
			</Button>
			<Message feedback={feedback} />
		</form>
	);
}

const IDIOMA_LABELS: Record<string, string> = {
	es_ar: "Español rioplatense",
	es_es: "Español de España",
};

function AddIdioma({ slug, options }: { slug: string; options: string[] }) {
	const { pending, feedback, run } = useAction();
	const [value, setValue] = useState(options[0] ?? "");
	if (options.length === 0) return null;
	return (
		<form
			className="flex flex-wrap items-center gap-3"
			onSubmit={(event) => {
				event.preventDefault();
				run(() =>
					saveListValue(
						slug,
						"idioma",
						value,
						IDIOMA_LABELS[value] ?? value,
						true,
					),
				);
			}}
		>
			<select
				aria-label="Idioma a agregar"
				className={INPUT}
				disabled={pending}
				onChange={(event) => setValue(event.target.value)}
				value={value}
			>
				{options.map((option) => (
					<option key={option} value={option}>
						{IDIOMA_LABELS[option] ?? option}
					</option>
				))}
			</select>
			<Button disabled={pending} size="sm" type="submit">
				Agregar idioma
			</Button>
			<Message feedback={feedback} />
		</form>
	);
}

export function ListsSection({
	slug,
	values,
	idiomas,
}: {
	slug: string;
	values: ListValueRow[];
	/** Los idiomas que soporta la plataforma. */
	idiomas: readonly string[];
}) {
	const of = (kind: ListValueRow["kind"]) =>
		values.filter((row) => row.kind === kind);
	const taken = new Set(of("idioma").map((row) => row.value));
	return (
		<div className="space-y-6">
			{(
				[
					["Segmentos", of("segmento")],
					["Idiomas", of("idioma")],
				] as const
			).map(([title, rows]) => (
				<div className="space-y-2" key={title}>
					<h3 className="font-medium text-sm">{title}</h3>
					{rows.length === 0 ? (
						<p className="text-muted-foreground text-sm">
							Todavía no hay ninguno.
						</p>
					) : (
						<ul className="divide-y rounded-lg border bg-card">
							{rows.map((row) => (
								<ValueRow
									key={`${row.kind}:${row.value}`}
									row={row}
									slug={slug}
								/>
							))}
						</ul>
					)}
					{title === "Segmentos" ? (
						<AddSegment slug={slug} />
					) : (
						<AddIdioma
							options={idiomas.filter((idioma) => !taken.has(idioma))}
							slug={slug}
						/>
					)}
				</div>
			))}
		</div>
	);
}
