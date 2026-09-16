import Link from "next/link";
import { notFound } from "next/navigation";
import { Card } from "@/components/ui/card";
import {
	type Funnel,
	RECENT_DAYS,
	toFunnel,
} from "@/lib/outreach/pipeline-query";
import { STAGE_LABELS } from "@/lib/outreach/stage";
import { createServerSupabase } from "@/lib/supabase/server";
import { resolveTenantAccess } from "@/lib/tenants/resolve";

export default async function PipelinePage({
	params,
}: {
	params: Promise<{ tenant: string }>;
}) {
	const { tenant: slug } = await params;
	const tenant = await resolveTenantAccess(slug);
	// 404 y no 403: un 403 le confirma a cualquiera que el cliente existe.
	if (!tenant) notFound();

	const supabase = await createServerSupabase();
	// Con el cliente del usuario, no service role: la RLS contacts_select ya
	// limita a los miembros del tenant, que es la visibilidad que queremos.
	const { data, error } = await supabase
		.from("contacts")
		.select("stage, last_touch_at")
		.eq("tenant_id", tenant.id);

	if (error) {
		return (
			<Card className="p-6">
				<h1 className="font-semibold text-lg tracking-display">Pipeline</h1>
				<p className="mt-2 text-destructive text-sm">
					No se pudo leer el pipeline. Recargá la página; si sigue igual, algo
					anda mal con la base.
				</p>
			</Card>
		);
	}

	const funnel = toFunnel(data ?? [], new Date());

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

			<Funnel slug={slug} funnel={funnel} />

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

function Funnel({ slug, funnel }: { slug: string; funnel: Funnel }) {
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
						{/* La barra es proporcional al total, así que a simple vista se ve
						    dónde se junta la gente sin leer los números. */}
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
