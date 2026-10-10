"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { ROLE_LABELS } from "@/lib/tenants/role-labels";
import { type ActionResult, changeMemberRole } from "./actions";
import { type Feedback, runRowAction } from "./run-row-action";

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

/**
 * Botón que corre una server action y muestra lo que respondió. La action
 * llega ya ligada a su fila (`.bind` en la página): acá no se arma ningún id.
 */
export function ActionButton({
	run,
	label,
	confirmText,
}: {
	run: () => Promise<ActionResult>;
	label: string;
	/** Si viene, se pide confirmación antes de correr la acción. */
	confirmText?: string;
}) {
	const router = useRouter();
	const [pending, startTransition] = useTransition();
	const [feedback, setFeedback] = useState<Feedback>(null);

	function onClick() {
		setFeedback(null);
		startTransition(async () => {
			const out = await runRowAction({
				run,
				confirmText,
				confirm: window.confirm.bind(window),
				refresh: router.refresh,
			});
			setFeedback(out.feedback);
		});
	}

	return (
		<span className="inline-flex items-center gap-2">
			<Message feedback={feedback} />
			<Button
				disabled={pending}
				onClick={onClick}
				size="sm"
				type="button"
				variant="outline"
			>
				{label}
			</Button>
		</span>
	);
}

export function RoleSelect({
	membershipId,
	slug,
	role,
}: {
	membershipId: string;
	slug: string;
	role: "tenant_admin" | "tenant_member";
}) {
	const router = useRouter();
	const [pending, startTransition] = useTransition();
	const [feedback, setFeedback] = useState<Feedback>(null);
	const [resetKey, setResetKey] = useState(0);

	function onChange(next: string) {
		setFeedback(null);
		startTransition(async () => {
			const out = await runRowAction({
				run: () => changeMemberRole(membershipId, next, slug),
				confirm: window.confirm.bind(window),
				refresh: router.refresh,
			});
			setFeedback(out.feedback);
			// El select no es controlado: si falló, el rol del servidor no cambió
			// y la key tampoco, así que se remonta a mano para mostrar el rol real.
			if (out.failed) setResetKey((n) => n + 1);
		});
	}

	return (
		<span className="inline-flex items-center gap-2">
			<select
				aria-label="Rol"
				className="h-8 rounded-md border border-input bg-transparent px-2 text-sm"
				defaultValue={role}
				disabled={pending}
				key={`${role}-${resetKey}`}
				onChange={(event) => onChange(event.target.value)}
			>
				<option value="tenant_member">{ROLE_LABELS.tenant_member}</option>
				<option value="tenant_admin">{ROLE_LABELS.tenant_admin}</option>
			</select>
			<Message feedback={feedback} />
		</span>
	);
}
