"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import {
	ACCOUNT_LABELS,
	type AccountKey,
	type AccountState,
	STATE_LABELS,
} from "@/lib/accounts/status";
import { startAccountAuthorization } from "./actions";

const REAUTH_WARNING =
	"Hasta que completes el consentimiento, esta cuenta deja de funcionar. ¿Seguimos?";

export function AccountCard({
	slug,
	account,
	state,
	note,
}: {
	slug: string;
	account: AccountKey;
	state: AccountState;
	note?: string;
}) {
	const [pending, startTransition] = useTransition();
	const [message, setMessage] = useState<string | null>(null);
	// Solo se ofrece autorizar cuando se sabe el estado: con "desconocido" el
	// grant puede estar sano y arrancar una autorización lo rompería.
	const canAuthorize = state === "autorizada" || state === "sin_autorizar";

	function authorize() {
		if (state === "autorizada" && !window.confirm(REAUTH_WARNING)) return;
		setMessage(null);
		startTransition(async () => {
			const result = await startAccountAuthorization(slug, account);
			if (!result.ok) {
				setMessage(result.message);
				return;
			}
			window.open(result.url, "_blank", "noopener,noreferrer");
			setMessage(
				"Completá la autorización en la pestaña que se abrió y recargá esta página.",
			);
		});
	}

	return (
		<li className="flex flex-wrap items-center gap-3 px-4 py-3">
			<div className="min-w-0 flex-1">
				<div className="font-medium text-sm">{ACCOUNT_LABELS[account]}</div>
				<div className="text-muted-foreground text-sm">
					{STATE_LABELS[state]}
				</div>
				{note ? (
					<div className="text-muted-foreground text-xs">{note}</div>
				) : null}
				{message ? (
					<div className="text-xs" role="status">
						{message}
					</div>
				) : null}
			</div>
			{canAuthorize ? (
				<Button
					disabled={pending}
					onClick={authorize}
					size="sm"
					type="button"
					variant={state === "autorizada" ? "outline" : "default"}
				>
					{state === "autorizada" ? "Reautorizar" : "Autorizar"}
				</Button>
			) : null}
		</li>
	);
}
