// app/plataforma/[slug]/console/domain-section.tsx
"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import type { Feedback } from "@/app/[tenant]/settings/usuarios/run-row-action";
import { runRowAction } from "@/app/[tenant]/settings/usuarios/run-row-action";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { DomainStatus } from "@/lib/domains/service";
import { type DnsInstructions, STATUS_LABELS } from "@/lib/domains/view";
import {
	addTenantDomain,
	makeTenantDomainPrimary,
	removeTenantDomain,
	verifyTenantDomain,
} from "../domain-actions";
import { ConsoleMessage } from "./console-button";

export interface DomainView {
	id: string;
	hostname: string;
	isPrimary: boolean;
	status: DomainStatus;
	lastError: string | null;
	dns: DnsInstructions | null;
}

function DnsBlock({
	hostname,
	dns,
}: {
	hostname: string;
	dns: DnsInstructions;
}) {
	return (
		<div className="mt-2 space-y-1 rounded-md bg-muted/50 p-3 text-xs">
			<p className="font-medium">Qué tiene que crear el cliente en su DNS</p>
			{dns.cname ? (
				<p>
					Registro <strong>CNAME</strong>: nombre{" "}
					<code className="break-all">{hostname}</code>, valor{" "}
					<code className="break-all">{dns.cname}</code>
				</p>
			) : (
				<p className="text-muted-foreground">
					Vercel todavía no informó el valor del CNAME. Probá en un rato.
				</p>
			)}
			{dns.txt ? (
				<p>
					Registro <strong>TXT</strong> de propiedad: nombre{" "}
					<code className="break-all">{dns.txt.name}</code>, valor{" "}
					<code className="break-all">{dns.txt.value}</code>
				</p>
			) : null}
		</div>
	);
}

function DomainRowItem({
	slug,
	tenantId,
	domain,
}: {
	slug: string;
	tenantId: string;
	domain: DomainView;
}) {
	const router = useRouter();
	const [pending, startTransition] = useTransition();
	const [feedback, setFeedback] = useState<Feedback>(null);

	function act(
		run: () => ReturnType<typeof verifyTenantDomain>,
		confirmText?: string,
	) {
		setFeedback(null);
		startTransition(async () => {
			const out = await runRowAction({
				run,
				confirmText,
				confirm: (text) => window.confirm(text),
				refresh: () => router.refresh(),
			});
			if (out.ran) setFeedback(out.feedback);
		});
	}

	return (
		<li className="space-y-1 px-4 py-3 text-sm">
			<div className="flex flex-wrap items-center gap-2">
				<span className="min-w-0 break-all font-medium">{domain.hostname}</span>
				<span className="rounded-full border px-2 py-0.5 text-xs">
					{STATUS_LABELS[domain.status]}
				</span>
				{domain.isPrimary ? (
					<span className="rounded-full bg-primary/10 px-2 py-0.5 text-primary text-xs">
						Principal
					</span>
				) : null}
				<span className="ml-auto inline-flex flex-wrap items-center gap-2">
					<ConsoleMessage feedback={feedback} />
					{domain.status !== "active" ? (
						<Button
							disabled={pending}
							onClick={() =>
								act(() => verifyTenantDomain(slug, tenantId, domain.id))
							}
							size="sm"
							type="button"
							variant="outline"
						>
							Verificar ahora
						</Button>
					) : null}
					{domain.status === "active" && !domain.isPrimary ? (
						<Button
							disabled={pending}
							onClick={() =>
								act(() => makeTenantDomainPrimary(slug, tenantId, domain.id))
							}
							size="sm"
							type="button"
							variant="outline"
						>
							Hacer principal
						</Button>
					) : null}
					<Button
						disabled={pending}
						onClick={() =>
							act(
								() => removeTenantDomain(slug, tenantId, domain.id),
								`¿Quitar ${domain.hostname}? Deja de servir esta empresa y se saca de Vercel.`,
							)
						}
						size="sm"
						type="button"
						variant="outline"
					>
						Quitar
					</Button>
				</span>
			</div>
			{domain.lastError ? (
				<p className="text-muted-foreground text-xs">{domain.lastError}</p>
			) : null}
			{domain.dns ? (
				<DnsBlock dns={domain.dns} hostname={domain.hostname} />
			) : null}
		</li>
	);
}

function AddDomainForm({ slug, tenantId }: { slug: string; tenantId: string }) {
	const router = useRouter();
	const [pending, startTransition] = useTransition();
	const [value, setValue] = useState("");
	const [feedback, setFeedback] = useState<Feedback>(null);

	function submit(event: React.FormEvent) {
		event.preventDefault();
		setFeedback(null);
		startTransition(async () => {
			const out = await runRowAction({
				run: () => addTenantDomain(slug, tenantId, value),
				confirm: () => true,
				refresh: () => router.refresh(),
			});
			if (out.feedback) setFeedback(out.feedback);
			if (!out.failed) setValue("");
		});
	}

	return (
		<form className="flex flex-wrap items-center gap-2" onSubmit={submit}>
			<label className="sr-only" htmlFor="new-domain">
				Dominio de la empresa
			</label>
			<Input
				className="h-8 min-w-0 flex-1 text-sm"
				disabled={pending}
				id="new-domain"
				onChange={(event) => setValue(event.target.value)}
				placeholder="ai.tuempresa.com"
				value={value}
			/>
			<Button disabled={pending || value.trim() === ""} size="sm" type="submit">
				Agregar dominio
			</Button>
			<ConsoleMessage feedback={feedback} />
		</form>
	);
}

export function DomainSection({
	slug,
	tenantId,
	domains,
	apiReady,
	readError,
}: {
	slug: string;
	tenantId: string;
	domains: DomainView[];
	/** Faltan las variables de la API de Vercel o de Supabase: cargar un dominio no va a andar. */
	apiReady: { vercel: boolean; supabase: boolean };
	readError: boolean;
}) {
	return (
		<div className="space-y-3">
			<p className="text-muted-foreground text-sm">
				El dominio propio del cliente (por ejemplo ai.tuempresa.com): la app, el
				login y las URLs de conexión por MCP salen con ese dominio. El cliente
				crea un registro CNAME y, cuando el DNS responde, queda activo solo.
			</p>
			{!apiReady.vercel || !apiReady.supabase ? (
				<p className="text-destructive text-sm" role="alert">
					Falta configurar en el servidor:{" "}
					{[
						!apiReady.vercel &&
							"la API de Vercel (VERCEL_API_TOKEN y VERCEL_PROJECT_ID)",
						!apiReady.supabase &&
							"la API de Supabase (SUPABASE_ACCESS_TOKEN y SUPABASE_PROJECT_REF)",
					]
						.filter(Boolean)
						.join(" y ")}
					. Sin eso no se pueden cargar ni activar dominios.
				</p>
			) : null}
			{readError ? (
				<p className="text-destructive text-sm" role="alert">
					No se pudieron leer los dominios. Recargá la página.
				</p>
			) : domains.length === 0 ? (
				<p className="text-muted-foreground text-sm">
					Todavía no tiene un dominio propio. Sigue entrando por la dirección de
					la plataforma.
				</p>
			) : (
				<ul className="divide-y rounded-lg border">
					{domains.map((domain) => (
						<DomainRowItem
							domain={domain}
							key={domain.id}
							slug={slug}
							tenantId={tenantId}
						/>
					))}
				</ul>
			)}
			<AddDomainForm slug={slug} tenantId={tenantId} />
		</div>
	);
}
