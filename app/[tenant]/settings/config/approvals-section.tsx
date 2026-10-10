"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import {
	POLICIES,
	POLICY_HELP,
	POLICY_LABELS,
	type Policy,
} from "@/lib/tenants/approvals";
import { saveApproval } from "../config-actions";
import { type Feedback, runRowAction } from "../usuarios/run-row-action";

export interface AgentApprovals {
	agent: string;
	name: string;
	nodes: { node: string; policy: Policy }[];
}

function NodeRow({
	slug,
	agent,
	node,
	policy,
}: {
	slug: string;
	agent: string;
	node: string;
	policy: Policy;
}) {
	const router = useRouter();
	const [pending, startTransition] = useTransition();
	const [feedback, setFeedback] = useState<Feedback>(null);
	const [value, setValue] = useState<Policy>(policy);

	function change(next: Policy) {
		const previous = value;
		setValue(next);
		setFeedback(null);
		startTransition(async () => {
			const out = await runRowAction({
				run: () => saveApproval(slug, agent, node, next),
				confirm: () => true,
				refresh: () => router.refresh(),
			});
			// Si no se guardó, el selector vuelve a lo que la base tiene.
			if (out.failed) setValue(previous);
			setFeedback(
				out.feedback ?? (out.failed ? null : { ok: true, text: "Guardado." }),
			);
		});
	}

	return (
		<li className="flex flex-wrap items-center gap-3 px-4 py-3">
			<div className="min-w-0 flex-1">
				<div className="font-mono text-sm">{node}</div>
				<div className="text-muted-foreground text-xs">
					{POLICY_HELP[value]}
				</div>
			</div>
			{feedback ? (
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
			) : null}
			<select
				aria-label={`Política de ${node}`}
				className="h-9 rounded-md border border-input bg-transparent px-2 text-sm"
				disabled={pending}
				onChange={(event) => change(event.target.value as Policy)}
				value={value}
			>
				{POLICIES.map((option) => (
					<option key={option} value={option}>
						{POLICY_LABELS[option]}
					</option>
				))}
			</select>
		</li>
	);
}

export function ApprovalsSection({
	slug,
	agents,
}: {
	slug: string;
	agents: AgentApprovals[];
}) {
	if (agents.length === 0) {
		return (
			<p className="text-muted-foreground text-sm">
				No hay pasos que requieran una política de aprobación.
			</p>
		);
	}
	return (
		<div className="space-y-4">
			<p className="text-muted-foreground text-sm">
				Son los pasos en los que el agente escribe en tus sistemas. Lo que le
				llega a una persona de afuera siempre pide aprobación. Estas reglas
				gobiernan los procesos automáticos; el chat sigue pidiendo aprobación
				según cada una de sus herramientas.
			</p>
			{agents.map(({ agent, name, nodes }) => (
				<div key={agent}>
					<h3 className="mb-2 font-medium text-sm">{name}</h3>
					<ul className="divide-y rounded-lg border bg-card">
						{nodes.map(({ node, policy }) => (
							<NodeRow
								agent={agent}
								key={node}
								node={node}
								policy={policy}
								slug={slug}
							/>
						))}
					</ul>
				</div>
			))}
		</div>
	);
}
