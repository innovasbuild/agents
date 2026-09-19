"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { type Funnel, RECENT_DAYS } from "@/lib/outreach/pipeline-query";
import { STAGE_LABELS } from "@/lib/outreach/stage";
import { createBrowserSupabase } from "@/lib/supabase/browser";

export function PipelineClient({
	slug,
	tenantId,
	funnel,
}: {
	slug: string;
	tenantId: string;
	funnel: Funnel;
}) {
	const router = useRouter();
	const [realtimeCaido, setRealtimeCaido] = useState(false);

	// Mismo patrón que cola-client.tsx: cliente del usuario (anon + JWT), y
	// getSession() antes de abrir el canal, porque el cliente recién creado
	// todavía no cargó la sesión de las cookies. Suscribirse antes de eso
	// une el canal con la key anon, sin membership, y la Realtime API nunca
	// registra la suscripción (RLS de contacts la bloquea).
	useEffect(() => {
		const supabase = createBrowserSupabase();
		let channel: ReturnType<typeof supabase.channel> | null = null;
		let cancelled = false;

		supabase.auth.getSession().then(
			() => {
				if (cancelled) return;
				channel = supabase
					.channel(`pipeline-${tenantId}`)
					.on(
						"postgres_changes",
						{
							event: "*",
							schema: "public",
							table: "contacts",
							filter: `tenant_id=eq.${tenantId}`,
						},
						() => router.refresh(),
					)
					.subscribe();
			},
			() => {
				if (!cancelled) setRealtimeCaido(true);
			},
		);

		return () => {
			cancelled = true;
			if (channel) supabase.removeChannel(channel);
		};
	}, [tenantId, router]);

	return (
		<div className="flex flex-col gap-6">
			<header className="flex flex-col gap-1">
				<h1 className="font-semibold text-2xl tracking-display">Pipeline</h1>
				<p className="text-muted-foreground text-sm">
					{funnel.total === 0
						? "Todavía no hay contactos en la escalera."
						: `${funnel.total} ${funnel.total === 1 ? "contacto" : "contactos"} en la escalera. Tocá una etapa para ver quiénes son.`}
				</p>
			</header>

			{realtimeCaido ? (
				<p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-destructive text-sm">
					La actualización automática no está andando: refrescá la página para
					ver el pipeline al día.
				</p>
			) : null}

			<FunnelCard slug={slug} funnel={funnel} />

			{funnel.sinAtribucion > 0 ? (
				<Card className="p-4">
					<p className="text-sm">
						<span className="font-medium">
							{funnel.sinAtribucion}{" "}
							{funnel.sinAtribucion === 1 ? "contacto" : "contactos"} sin
							atribución
						</span>
						<span className="text-muted-foreground">
							{" "}
							— llegaron por otro lado, así que no cuentan en los porcentajes de
							arriba.
						</span>
					</p>
					<Link
						className="mt-2 inline-block text-sm underline underline-offset-4"
						href={`/${slug}/contactos?etapa=sin_atribucion`}
					>
						Verlos
					</Link>
				</Card>
			) : null}
		</div>
	);
}

function FunnelCard({ slug, funnel }: { slug: string; funnel: Funnel }) {
	return (
		<Card className="divide-y">
			{funnel.steps.map((step) => (
				<Link
					key={step.stage}
					href={`/${slug}/contactos?etapa=${step.stage}`}
					className="flex min-h-11 items-center gap-4 p-4 hover:bg-muted/50"
				>
					<div className="min-w-0 flex-1">
						<p className="truncate font-medium text-sm">
							{STAGE_LABELS[step.stage]}
						</p>
						<div
							className="mt-2 h-1.5 rounded-full bg-muted"
							aria-hidden="true"
						>
							<div
								className="h-full rounded-full bg-primary"
								style={{ width: `${step.percent}%` }}
							/>
						</div>
					</div>
					<div className="shrink-0 text-right">
						<p className="font-semibold tabular-nums">{step.count}</p>
						<p className="text-muted-foreground text-xs tabular-nums">
							{step.percent}%
						</p>
					</div>
					<div className="hidden w-28 shrink-0 text-right text-muted-foreground text-xs sm:block">
						{step.recent > 0
							? `${step.recent} con movimiento`
							: "sin movimiento"}
					</div>
				</Link>
			))}
			<p className="p-3 text-muted-foreground text-xs">
				«Movimiento» es un toque en los últimos {RECENT_DAYS} días.
			</p>
		</Card>
	);
}
