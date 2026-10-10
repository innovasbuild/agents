"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { removeExecutor, saveExecutor } from "../config-actions";
import { ActionButton } from "../usuarios/row-actions";
import { type Feedback, runRowAction } from "../usuarios/run-row-action";

export interface ExecutorView {
	userId: string;
	person: string;
	slug: string;
	displayName: string;
	title: string;
	linkedinUrl: string;
	dailyQuota: number;
	gmailAuthorizedAt: string | null;
	crmOwnerId: string | null;
}

export interface CandidateView {
	userId: string;
	person: string;
	suggestedSlug: string;
}

interface Draft {
	slug: string;
	displayName: string;
	title: string;
	linkedinUrl: string;
	// Texto: así un campo vacío se ve vacío y no se vuelve 0 sin avisar.
	dailyQuota: string;
}

const MAX_QUOTA = 200;
const DEFAULT_QUOTA = 30;
// Mismo formato que la base (executors.slug) y que set_executor.
const SLUG_PATTERN = "[a-z][a-z0-9-]{0,30}";

/** La persona elegida, o la primera disponible si la elegida ya no está. */
export function resolveCandidate(
	candidates: CandidateView[],
	userId: string,
): CandidateView | undefined {
	return candidates.find((c) => c.userId === userId) ?? candidates[0];
}

/** Borrador limpio para dar de alta a esa persona, con el slug sugerido. */
export function initialDraftFor(candidate: CandidateView | undefined): Draft {
	return {
		slug: candidate?.suggestedSlug ?? "",
		displayName: "",
		title: "",
		linkedinUrl: "",
		dailyQuota: String(DEFAULT_QUOTA),
	};
}

export function parseDraft(
	draft: Draft,
):
	| { ok: true; input: Omit<Draft, "dailyQuota"> & { dailyQuota: number } }
	| { ok: false; message: string } {
	const quota =
		draft.dailyQuota.trim() === "" ? Number.NaN : Number(draft.dailyQuota);
	if (!Number.isInteger(quota) || quota < 0 || quota > MAX_QUOTA) {
		return {
			ok: false,
			message: `El cupo diario es un número entre 0 y ${MAX_QUOTA}.`,
		};
	}
	return { ok: true, input: { ...draft, dailyQuota: quota } };
}

function Message({ feedback }: { feedback: Feedback }) {
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

function Fields({
	draft,
	onChange,
	disabled,
	idPrefix,
}: {
	draft: Draft;
	onChange: (draft: Draft) => void;
	disabled: boolean;
	idPrefix: string;
}) {
	const field = (
		key: keyof Draft,
		label: string,
		extra: Record<string, unknown> = {},
	) => (
		<label
			className="block min-w-0 flex-1 basis-40 text-muted-foreground text-xs"
			htmlFor={`${idPrefix}-${key}`}
		>
			{label}
			<Input
				className="mt-1"
				disabled={disabled}
				id={`${idPrefix}-${key}`}
				onChange={(event) =>
					onChange({
						...draft,
						[key]: event.target.value,
					})
				}
				value={draft[key]}
				{...extra}
			/>
		</label>
	);

	return (
		<div className="flex flex-wrap gap-3">
			{field("slug", "Slug", {
				required: true,
				pattern: SLUG_PATTERN,
				maxLength: 31,
				title: "Minúsculas, números y guiones; empieza con una letra.",
			})}
			{field("displayName", "Nombre en la firma")}
			{field("title", "Puesto")}
			{field("linkedinUrl", "LinkedIn", {
				placeholder: "https://www.linkedin.com/in/…",
			})}
			{field("dailyQuota", "Cupo diario", {
				type: "number",
				required: true,
				min: 0,
				max: MAX_QUOTA,
				step: 1,
			})}
		</div>
	);
}

function ExecutorRow({
	slug,
	executor,
}: {
	slug: string;
	executor: ExecutorView;
}) {
	const router = useRouter();
	const [pending, startTransition] = useTransition();
	const [feedback, setFeedback] = useState<Feedback>(null);
	const [draft, setDraft] = useState<Draft>({
		slug: executor.slug,
		displayName: executor.displayName,
		title: executor.title,
		linkedinUrl: executor.linkedinUrl,
		dailyQuota: String(executor.dailyQuota),
	});

	function save(event: React.FormEvent) {
		event.preventDefault();
		const parsed = parseDraft(draft);
		if (!parsed.ok) {
			setFeedback({ ok: false, text: parsed.message });
			return;
		}
		setFeedback(null);
		startTransition(async () => {
			const out = await runRowAction({
				run: () => saveExecutor(slug, executor.userId, parsed.input),
				confirm: () => true,
				refresh: () => router.refresh(),
			});
			setFeedback(
				out.feedback ?? (out.failed ? null : { ok: true, text: "Guardado." }),
			);
		});
	}

	return (
		<li className="px-4 py-3">
			<form className="space-y-3" onSubmit={save}>
				<div className="flex flex-wrap items-center gap-x-3 gap-y-1">
					<span className="font-medium text-sm">{executor.person}</span>
					<span className="text-muted-foreground text-xs">
						{executor.gmailAuthorizedAt
							? "Gmail autorizado"
							: "Falta autorizar Gmail"}
					</span>
					<span className="text-muted-foreground text-xs">
						{executor.crmOwnerId
							? "HubSpot vinculado"
							: "Falta autorizar HubSpot"}
					</span>
				</div>
				<Fields
					disabled={pending}
					draft={draft}
					idPrefix={executor.userId}
					onChange={setDraft}
				/>
				<div className="flex flex-wrap items-center gap-2">
					<Button disabled={pending} size="sm" type="submit">
						Guardar
					</Button>
					<Message feedback={feedback} />
					<span className="ml-auto">
						<ActionButton
							confirmText="¿Quitar a esta persona de los ejecutores? Si ya tiene envíos o contactos no se puede: ponele cupo 0."
							label="Quitar"
							run={() => removeExecutor(slug, executor.userId)}
						/>
					</span>
				</div>
			</form>
		</li>
	);
}

export function AddExecutor({
	slug,
	candidates,
}: {
	slug: string;
	candidates: CandidateView[];
}) {
	const router = useRouter();
	const [pending, startTransition] = useTransition();
	const [feedback, setFeedback] = useState<Feedback>(null);
	const [chosen, setChosen] = useState(candidates[0]?.userId ?? "");
	const [draft, setDraft] = useState<Draft>(() =>
		initialDraftFor(candidates[0]),
	);
	// Lo que se ve y lo que se manda salen de la misma persona.
	const selected = resolveCandidate(candidates, chosen);

	function pick(next: string) {
		setChosen(next);
		setDraft(initialDraftFor(candidates.find((c) => c.userId === next)));
	}

	function submit(event: React.FormEvent) {
		event.preventDefault();
		if (!selected) return;
		const parsed = parseDraft(draft);
		if (!parsed.ok) {
			setFeedback({ ok: false, text: parsed.message });
			return;
		}
		setFeedback(null);
		startTransition(async () => {
			const out = await runRowAction({
				run: () => saveExecutor(slug, selected.userId, parsed.input),
				confirm: () => true,
				refresh: () => router.refresh(),
			});
			setFeedback(
				out.feedback ??
					(out.failed ? null : { ok: true, text: "Ejecutor agregado." }),
			);
		});
	}

	return (
		<form
			className="space-y-3 rounded-lg border bg-card px-4 py-3"
			onSubmit={submit}
		>
			<h3 className="font-medium text-sm">Agregar ejecutor</h3>
			<label
				className="block text-muted-foreground text-xs"
				htmlFor="nuevo-ejecutor"
			>
				Persona
				<select
					className="mt-1 block h-9 max-w-full rounded-md border border-input bg-transparent px-3 text-foreground text-sm"
					disabled={pending}
					id="nuevo-ejecutor"
					onChange={(event) => pick(event.target.value)}
					value={selected?.userId ?? ""}
				>
					{candidates.map((candidate) => (
						<option key={candidate.userId} value={candidate.userId}>
							{candidate.person}
						</option>
					))}
				</select>
			</label>
			<Fields
				disabled={pending}
				draft={draft}
				idPrefix="nuevo"
				onChange={setDraft}
			/>
			<div className="flex flex-wrap items-center gap-2">
				<Button disabled={pending} size="sm" type="submit">
					Agregar
				</Button>
				<Message feedback={feedback} />
			</div>
		</form>
	);
}

export function ExecutorsSection({
	slug,
	executors,
	candidates,
}: {
	slug: string;
	executors: ExecutorView[];
	candidates: CandidateView[];
}) {
	return (
		<div className="space-y-4">
			{executors.length === 0 ? (
				<p className="text-muted-foreground text-sm">
					Todavía no hay ejecutores configurados.
				</p>
			) : (
				<ul className="divide-y rounded-lg border bg-card">
					{executors.map((executor) => (
						<ExecutorRow
							executor={executor}
							key={executor.userId}
							slug={slug}
						/>
					))}
				</ul>
			)}
			{candidates.length > 0 ? (
				<AddExecutor
					candidates={candidates}
					// Al cambiar quiénes quedan, el formulario arranca de cero.
					key={candidates.map((c) => c.userId).join(",")}
					slug={slug}
				/>
			) : (
				<p className="text-muted-foreground text-sm">
					Todos los miembros ya son ejecutores. Para sumar a alguien, invitalo
					primero desde Usuarios.
				</p>
			)}
		</div>
	);
}
