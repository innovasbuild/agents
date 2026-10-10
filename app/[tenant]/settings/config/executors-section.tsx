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
	dailyQuota: number;
}

const MAX_QUOTA = 200;
const DEFAULT_QUOTA = 30;

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
						[key]:
							key === "dailyQuota"
								? Number(event.target.value)
								: event.target.value,
					})
				}
				value={draft[key]}
				{...extra}
			/>
		</label>
	);

	return (
		<div className="flex flex-wrap gap-3">
			{field("slug", "Slug")}
			{field("displayName", "Nombre en la firma")}
			{field("title", "Puesto")}
			{field("linkedinUrl", "LinkedIn", {
				placeholder: "https://www.linkedin.com/in/…",
			})}
			{field("dailyQuota", "Cupo diario", {
				type: "number",
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
		dailyQuota: executor.dailyQuota,
	});

	function save() {
		setFeedback(null);
		startTransition(async () => {
			const out = await runRowAction({
				run: () => saveExecutor(slug, executor.userId, draft),
				confirm: () => true,
				refresh: () => router.refresh(),
			});
			setFeedback(
				out.feedback ?? (out.failed ? null : { ok: true, text: "Guardado." }),
			);
		});
	}

	return (
		<li className="space-y-3 px-4 py-3">
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
				<Button disabled={pending} onClick={save} size="sm" type="button">
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
		</li>
	);
}

function AddExecutor({
	slug,
	candidates,
}: {
	slug: string;
	candidates: CandidateView[];
}) {
	const router = useRouter();
	const [pending, startTransition] = useTransition();
	const [feedback, setFeedback] = useState<Feedback>(null);
	const [userId, setUserId] = useState(candidates[0]?.userId ?? "");
	const [draft, setDraft] = useState<Draft>({
		slug: candidates[0]?.suggestedSlug ?? "",
		displayName: "",
		title: "",
		linkedinUrl: "",
		dailyQuota: DEFAULT_QUOTA,
	});

	function pick(next: string) {
		setUserId(next);
		setDraft({
			...draft,
			slug: candidates.find((c) => c.userId === next)?.suggestedSlug ?? "",
		});
	}

	function submit(event: React.FormEvent) {
		event.preventDefault();
		setFeedback(null);
		startTransition(async () => {
			const out = await runRowAction({
				run: () => saveExecutor(slug, userId, draft),
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
					value={userId}
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
				<AddExecutor candidates={candidates} slug={slug} />
			) : (
				<p className="text-muted-foreground text-sm">
					Todos los miembros ya son ejecutores. Para sumar a alguien, invitalo
					primero desde Usuarios.
				</p>
			)}
		</div>
	);
}
