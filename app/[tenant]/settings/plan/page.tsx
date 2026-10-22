import Link from "next/link";
import { notFound } from "next/navigation";
import { Button } from "@/components/ui/button";
import { PLAN_CONTACT_HREF } from "@/lib/plans/contact";
import {
	limitMessage,
	monthStartUtc,
	PLAN_LIMITS,
	type Plan,
	trialWarning,
} from "@/lib/plans/limits";
import { createPlanStore } from "@/lib/plans/store";
import { createAdminClient } from "@/lib/supabase/admin";
import { resolveTenantAccess } from "@/lib/tenants/resolve";
import { AiLimitForm } from "./ai-limit-form";

const PLAN_NAMES: Record<Plan, string> = {
	free: "Free",
	pago: "Pago",
	enterprise: "Enterprise",
};

const usdNumber = (value: number) =>
	value.toLocaleString("es-AR", {
		minimumFractionDigits: 2,
		maximumFractionDigits: 2,
	});

const dateLabel = (iso: string) =>
	new Date(iso).toLocaleDateString("es-AR", {
		day: "numeric",
		month: "long",
		year: "numeric",
		timeZone: "UTC",
	});

const plural = (n: number, one: string, many: string) =>
	`${n} ${n === 1 ? one : many}`;

function Row({
	label,
	value,
	note,
}: {
	label: string;
	value: string;
	note?: string;
}) {
	return (
		<div className="flex items-baseline justify-between gap-4 px-4 py-3">
			<div>
				<p className="text-sm">{label}</p>
				{note ? <p className="text-muted-foreground text-xs">{note}</p> : null}
			</div>
			<p className="tabular-nums">{value}</p>
		</div>
	);
}

export default async function PlanPage({
	params,
}: {
	params: Promise<{ tenant: string }>;
}) {
	const { tenant: slug } = await params;
	const tenant = await resolveTenantAccess(slug);
	if (!tenant) notFound();
	// 404 y no 403, como el resto de settings: el plan es del administrador.
	if (tenant.role === "tenant_member") notFound();

	const now = new Date();
	let data: {
		plan: NonNullable<
			Awaited<ReturnType<ReturnType<typeof createPlanStore>["tenantPlan"]>>
		>;
		counts: Awaited<ReturnType<ReturnType<typeof createPlanStore>["counts"]>>;
		spent: number;
	} | null = null;
	try {
		// Admin client después del gate: usage_sum y tenant_counts son del service role.
		const store = createPlanStore(createAdminClient());
		const [plan, counts, spent] = await Promise.all([
			store.tenantPlan(tenant.id),
			store.counts(tenant.id),
			store.monthSpendUsd(tenant.id, monthStartUtc(now)),
		]);
		if (plan) data = { plan, counts, spent };
	} catch (error) {
		console.error("plan: no pude leer el plan:", error);
	}

	const back = (
		<Link
			className="inline-flex min-h-11 items-center text-muted-foreground text-sm hover:text-foreground"
			href={`/${slug}/settings`}
		>
			← Configuración
		</Link>
	);

	if (!data)
		return (
			<div className="max-w-3xl space-y-8">
				<div>
					{back}
					<h1 className="text-3xl leading-tight">Plan</h1>
				</div>
				<p className="text-muted-foreground text-sm" role="alert">
					No pude leer el plan. Recargá la página.
				</p>
			</div>
		);

	const { plan: tp, counts, spent } = data;
	const limits = PLAN_LIMITS[tp.plan];
	const warning = trialWarning(tp, now);
	const reserved = counts.users + counts.pendingInvitations;

	return (
		<div className="max-w-3xl space-y-8">
			<div>
				{back}
				<h1 className="text-3xl leading-tight">Plan</h1>
			</div>

			<section>
				<h2 className="mb-1 text-lg">Plan actual</h2>
				<p className="text-3xl">{PLAN_NAMES[tp.plan]}</p>
			</section>

			{tp.suspendedReason ? (
				<div
					className="rounded-lg border border-destructive/40 p-4"
					role="alert"
				>
					<p className="font-medium">
						{limitMessage(`suspended:${tp.suspendedReason}`).title}
					</p>
					<p className="text-muted-foreground text-sm">
						{limitMessage(`suspended:${tp.suspendedReason}`).body}
					</p>
				</div>
			) : null}

			{tp.plan === "enterprise" ? (
				<p className="text-sm">
					El gasto en modelos de IA lo ves en{" "}
					<Link
						className="underline underline-offset-4"
						href={`/${slug}/settings/gasto`}
					>
						Gasto →
					</Link>
				</p>
			) : (
				<section>
					<h2 className="mb-3 text-lg">Uso</h2>
					<div className="divide-y rounded-lg border bg-card">
						{tp.plan === "free" ? (
							<>
								<Row
									label="Usuarios"
									note={
										counts.pendingInvitations > 0
											? `${plural(counts.users, "activo", "activos")} y ${plural(counts.pendingInvitations, "invitación pendiente", "invitaciones pendientes")}`
											: undefined
									}
									value={`${reserved} de ${limits.users}`}
								/>
								<Row
									label="Skills publicadas"
									value={`${counts.publishedSkills} de ${limits.skills}`}
								/>
								<Row
									label="IA este mes"
									value={`USD ${usdNumber(spent)} de ${limits.aiUsdPerMonth}`}
								/>
							</>
						) : (
							<>
								<Row label="Usuarios" value={String(counts.users)} />
								<Row
									label="Skills publicadas"
									value={String(counts.publishedSkills)}
								/>
								<Row label="IA" value={`USD ${usdNumber(spent)} este mes`} />
							</>
						)}
					</div>
				</section>
			)}

			{tp.plan === "free" && tp.trialEndsAt ? (
				<section>
					<h2 className="mb-1 text-lg">Fin del plan gratis</h2>
					<p className="text-sm">{dateLabel(tp.trialEndsAt)}</p>
					{warning ? (
						<p className="text-muted-foreground text-sm">
							Faltan {plural(warning.daysLeft, "día", "días")}.
						</p>
					) : null}
				</section>
			) : null}

			{tp.plan === "pago" ? (
				<section>
					<h2 className="mb-3 text-lg">Tope de IA</h2>
					<AiLimitForm initial={tp.aiMonthlyLimitUsd} slug={slug} />
				</section>
			) : null}

			{tp.plan === "free" ? (
				<Button asChild size="lg">
					<a href={PLAN_CONTACT_HREF}>Hablá con nosotros</a>
				</Button>
			) : null}
		</div>
	);
}
