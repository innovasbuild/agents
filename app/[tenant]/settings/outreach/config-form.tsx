// app/[tenant]/settings/outreach/config-form.tsx
"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { type Feedback, runRowAction } from "../usuarios/run-row-action";
import { saveOutreachConfig } from "./actions";
import { Message } from "./lists-section";

export interface OutreachConfigDraft {
	timezone: string;
	bcc: string;
	dealPipeline: string;
	dealStage: string;
	companyName: string;
	companyUrl: string;
	models: Record<string, string>;
}

const MODEL_ROLES: Record<string, string> = {
	draft_msg1: "Primer mensaje",
	draft_followup: "Seguimientos",
	classify: "Clasificar respuestas",
	researcher: "Investigar cuentas",
};

const INPUT =
	"h-9 w-full rounded-md border border-input bg-transparent px-2 text-sm";

export function OutreachConfigForm({
	slug,
	initial,
	allowedModels,
	defaults,
}: {
	slug: string;
	initial: OutreachConfigDraft;
	allowedModels: string[];
	/** El modelo que usa la plataforma si la empresa no elige uno. */
	defaults: Record<string, string>;
}) {
	const router = useRouter();
	const [pending, startTransition] = useTransition();
	const [feedback, setFeedback] = useState<Feedback>(null);
	const [draft, setDraft] = useState(initial);
	const set = (patch: Partial<OutreachConfigDraft>) =>
		setDraft((current) => ({ ...current, ...patch }));

	const field = (
		label: string,
		key: Exclude<keyof OutreachConfigDraft, "models">,
		help?: string,
	) => (
		<label className="block space-y-1 text-sm">
			<span>{label}</span>
			<input
				className={INPUT}
				disabled={pending}
				maxLength={300}
				onChange={(event) => set({ [key]: event.target.value })}
				value={draft[key]}
			/>
			{help ? (
				<span className="text-muted-foreground text-xs">{help}</span>
			) : null}
		</label>
	);

	return (
		<form
			className="space-y-4"
			onSubmit={(event) => {
				event.preventDefault();
				setFeedback(null);
				startTransition(async () => {
					const out = await runRowAction({
						run: () => saveOutreachConfig(slug, draft),
						confirm: () => true,
						refresh: () => router.refresh(),
					});
					setFeedback(
						out.feedback ??
							(out.failed ? null : { ok: true, text: "Guardado." }),
					);
				});
			}}
		>
			<div className="grid gap-4 sm:grid-cols-2">
				{field(
					"Zona horaria",
					"timezone",
					"Por ejemplo America/Argentina/Buenos_Aires.",
				)}
				{field(
					"Copia oculta (BCC)",
					"bcc",
					"Mail que recibe copia de cada envío. Vacío: sin copia.",
				)}
				{field(
					"Pipeline del deal",
					"dealPipeline",
					"Vacío: no se crean deals.",
				)}
				{field("Etapa inicial del deal", "dealStage")}
				{field("Empresa que firma", "companyName")}
				{field("URL de la empresa", "companyUrl")}
			</div>
			<div className="grid gap-4 sm:grid-cols-2">
				{Object.entries(MODEL_ROLES).map(([role, label]) => (
					<label className="block space-y-1 text-sm" key={role}>
						<span>Modelo: {label}</span>
						<select
							className={INPUT}
							disabled={pending}
							onChange={(event) =>
								set({ models: { ...draft.models, [role]: event.target.value } })
							}
							value={draft.models[role] ?? ""}
						>
							<option value="">
								El de la plataforma ({defaults[role] ?? "sin definir"})
							</option>
							{allowedModels.map((model) => (
								<option key={model} value={model}>
									{model}
								</option>
							))}
						</select>
					</label>
				))}
			</div>
			<div className="flex flex-wrap items-center gap-3">
				<Button disabled={pending} type="submit">
					Guardar datos
				</Button>
				<Message feedback={feedback} />
			</div>
		</form>
	);
}
