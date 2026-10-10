// app/plataforma/[slug]/console/agents-section.tsx
"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import type { Feedback } from "@/app/[tenant]/settings/usuarios/run-row-action";
import { runRowAction } from "@/app/[tenant]/settings/usuarios/run-row-action";
import { Button } from "@/components/ui/button";
import { AGENT_CATALOG, catalogAgents } from "@/lib/agents/catalog";
import { setAgent } from "../console-actions";
import { ConsoleMessage } from "./console-button";

const BRAIN_LABELS: Record<string, string> = {
	none: "Sin acceso",
	read: "Lectura",
	read_write: "Lectura y escritura",
};

export interface AgentState {
	agent: string;
	enabled: boolean;
	brain: string;
}

function AgentRow({
	slug,
	tenantId,
	agent,
	state,
}: {
	slug: string;
	tenantId: string;
	agent: keyof typeof AGENT_CATALOG;
	state: AgentState | undefined;
}) {
	const router = useRouter();
	const [pending, startTransition] = useTransition();
	const [feedback, setFeedback] = useState<Feedback>(null);
	const [enabled, setEnabled] = useState(state?.enabled ?? false);
	const [brain, setBrain] = useState(state?.brain ?? "read_write");
	const entry = AGENT_CATALOG[agent];

	function save() {
		setFeedback(null);
		startTransition(async () => {
			const out = await runRowAction({
				run: () =>
					setAgent(
						slug,
						tenantId,
						agent,
						enabled,
						entry.brain ? brain : "none",
					),
				confirm: () => true,
				refresh: () => router.refresh(),
			});
			setFeedback(
				out.feedback ?? (out.failed ? null : { ok: true, text: "Guardado." }),
			);
		});
	}

	return (
		<li className="flex flex-wrap items-center gap-3 px-4 py-3">
			<label className="flex min-w-0 flex-1 items-start gap-2 text-sm">
				<input
					checked={enabled}
					className="mt-1"
					disabled={pending}
					onChange={(event) => setEnabled(event.target.checked)}
					type="checkbox"
				/>
				<span>
					{entry.name}
					<span className="block text-muted-foreground text-xs">
						{entry.description}
					</span>
				</span>
			</label>
			{entry.brain ? (
				<select
					aria-label={`Acceso al brain de ${entry.name}`}
					className="h-8 rounded-md border border-input bg-transparent px-2 text-sm"
					disabled={pending}
					onChange={(event) => setBrain(event.target.value)}
					value={brain}
				>
					{Object.entries(BRAIN_LABELS).map(([value, label]) => (
						<option key={value} value={value}>
							{label}
						</option>
					))}
				</select>
			) : null}
			<ConsoleMessage feedback={feedback} />
			<Button
				disabled={pending}
				onClick={save}
				size="sm"
				type="button"
				variant="outline"
			>
				Guardar
			</Button>
		</li>
	);
}

export function AgentsSection({
	slug,
	tenantId,
	agents,
}: {
	slug: string;
	tenantId: string;
	agents: AgentState[];
}) {
	return (
		<ul className="divide-y rounded-lg border bg-card">
			{catalogAgents().map((agent) => (
				<AgentRow
					key={agent}
					agent={agent}
					slug={slug}
					state={agents.find((a) => a.agent === agent)}
					tenantId={tenantId}
				/>
			))}
		</ul>
	);
}
