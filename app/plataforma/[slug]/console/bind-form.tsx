// app/plataforma/[slug]/console/bind-form.tsx
"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import type { Feedback } from "@/app/[tenant]/settings/usuarios/run-row-action";
import { runRowAction } from "@/app/[tenant]/settings/usuarios/run-row-action";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
	acceptsManyUids,
	PROVIDERS,
	type ProviderKey,
} from "@/lib/connectors/providers";
import { bindConnection } from "../console-actions";
import { ConsoleMessage } from "./console-button";

const OFFERED = (Object.keys(PROVIDERS) as ProviderKey[]).filter(
	(p) => PROVIDERS[p].capability !== "brain",
);

/** `initialProvider` existe para probar el formulario de cada proveedor sin interacción. */
export function BindForm({
	slug,
	tenantId,
	initialProvider = OFFERED[0],
}: {
	slug: string;
	tenantId: string;
	initialProvider?: ProviderKey;
}) {
	const router = useRouter();
	const [pending, startTransition] = useTransition();
	const [feedback, setFeedback] = useState<Feedback>(null);
	const [provider, setProvider] = useState<ProviderKey>(initialProvider);
	const [uids, setUids] = useState<string[]>([""]);
	const info = PROVIDERS[provider];
	const withKey = info.authKind === "connect_api_key";

	function submit(event: React.FormEvent) {
		event.preventDefault();
		setFeedback(null);
		startTransition(async () => {
			const out = await runRowAction({
				run: () =>
					bindConnection(slug, tenantId, provider, withKey ? uids : []),
				confirm: () => true,
				refresh: () => router.refresh(),
			});
			if (!out.failed) setUids([""]);
			setFeedback(
				out.feedback ??
					(out.failed ? null : { ok: true, text: "Conector asociado." }),
			);
		});
	}

	return (
		<form
			className="space-y-3 rounded-lg border bg-card px-4 py-3 text-sm"
			onSubmit={submit}
		>
			<h3 className="font-medium">Asociar conector</h3>
			<label className="block">
				<span className="mb-1 block text-xs text-muted-foreground">
					Proveedor
				</span>
				<select
					className="h-9 rounded-md border border-input bg-transparent px-3 text-sm"
					disabled={pending}
					onChange={(event) => {
						setProvider(event.target.value as ProviderKey);
						setUids([""]);
					}}
					value={provider}
				>
					{OFFERED.map((p) => (
						<option key={p} value={p}>
							{p} · {PROVIDERS[p].capability}
						</option>
					))}
				</select>
			</label>
			<p className="text-muted-foreground text-xs">Acá nunca va la llave.</p>
			{withKey ? (
				<div className="space-y-2">
					<p className="text-muted-foreground text-xs">
						Pegá el identificador del conector creado en Vercel (
						<code>vercel connect list</code>).
					</p>
					{uids.map((uid, index) => (
						<Input
							aria-label={`Identificador ${index + 1}`}
							className="max-w-md font-mono"
							disabled={pending}
							// biome-ignore lint/suspicious/noArrayIndexKey: campos sin identidad propia
							key={index}
							onChange={(event) =>
								setUids(
									uids.map((u, i) => (i === index ? event.target.value : u)),
								)
							}
							placeholder="acme-coldiq"
							value={uid}
						/>
					))}
					{acceptsManyUids(provider) ? (
						<Button
							disabled={pending}
							onClick={() => setUids([...uids, ""])}
							size="sm"
							type="button"
							variant="outline"
						>
							Agregar otro
						</Button>
					) : null}
				</div>
			) : (
				<p className="text-muted-foreground text-xs">
					Este proveedor usa el conector de la plataforma: cada persona autoriza
					su propia cuenta desde la app.
				</p>
			)}
			<div className="flex flex-wrap items-center gap-2">
				<Button disabled={pending} size="sm" type="submit">
					Asociar
				</Button>
				<ConsoleMessage feedback={feedback} />
			</div>
		</form>
	);
}
