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

export type AuthorizationNotice = { message: string; url: string | null };

/**
 * El aviso posterior al clic. La URL de autorización vive solo en el estado
 * del componente (nunca en el HTML previo al clic, ni en logs): window.open
 * después de esperar a la acción queda fuera del gesto del clic y el
 * navegador puede bloquearlo sin que se note, así que el link visible es lo
 * que garantiza que la persona pueda completar el consentimiento.
 */
export function AccountNotice({ message, url }: AuthorizationNotice) {
	return (
		<div className="text-xs" role="status">
			{message}
			{url ? (
				<>
					{" "}
					<a
						className="underline"
						href={url}
						rel="noopener noreferrer"
						target="_blank"
					>
						Abrir la autorización
					</a>
				</>
			) : null}
		</div>
	);
}

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
	const [notice, setNotice] = useState<AuthorizationNotice | null>(null);
	// Solo se ofrece autorizar cuando se sabe el estado: con "desconocido" el
	// grant puede estar sano y arrancar una autorización lo rompería.
	const canAuthorize = state === "autorizada" || state === "sin_autorizar";

	function authorize() {
		if (state === "autorizada" && !window.confirm(REAUTH_WARNING)) return;
		setNotice(null);
		startTransition(async () => {
			const result = await startAccountAuthorization(slug, account);
			if (!result.ok) {
				setNotice({ message: result.message, url: null });
				return;
			}
			// Puede quedar bloqueado (Safari, o una acción lenta): por eso el link.
			window.open(result.url, "_blank", "noopener,noreferrer");
			setNotice({
				message:
					"Completá la autorización y recargá esta página. Si no se abrió una pestaña, abrí el link:",
				url: result.url,
			});
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
				{notice ? <AccountNotice {...notice} /> : null}
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
