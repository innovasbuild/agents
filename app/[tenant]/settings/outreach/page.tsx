// app/[tenant]/settings/outreach/page.tsx
import Link from "next/link";
import { notFound } from "next/navigation";
import {
	brainForTenant,
	type CanonLoad,
	loadIcpLevels,
} from "@/lib/outreach/canon";
import type { IcpLevels } from "@/lib/outreach/canon-blocks";
import {
	DEFAULT_OUTREACH_MODELS,
	parseOutreachConfig,
	SUPPORTED_IDIOMAS,
} from "@/lib/outreach/config";
import { toListValues } from "@/lib/outreach/outreach-settings-query";
import { dayStart } from "@/lib/outreach/time";
import { createServerSupabase } from "@/lib/supabase/server";
import { resolveTenantAccess } from "@/lib/tenants/resolve";
import {
	budgetResources,
	toBudgetRows,
	workflowRows,
} from "@/lib/workflows/settings";
import { OutreachConfigForm } from "./config-form";
import { ListsSection } from "./lists-section";
import { BudgetSummary, IcpSummary, MarcoSummary } from "./readonly-sections";
import { WorkflowsSection } from "./workflows-section";

const Unreadable = () => (
	<p className="text-muted-foreground text-sm">
		No pude leer esta sección. Recargá la página.
	</p>
);

const MARCO_EVENTS = [
	"outreach.marco_reflected",
	"outreach.marco_reflect_failed",
];

export default async function OutreachSettingsPage({
	params,
}: {
	params: Promise<{ tenant: string }>;
}) {
	const { tenant: slug } = await params;
	const tenant = await resolveTenantAccess(slug);
	if (!tenant) notFound();
	if (tenant.role === "tenant_member") notFound();

	const supabase = await createServerSupabase();
	const { data: agent, error: agentError } = await supabase
		.from("tenant_agents")
		.select("config, enabled")
		.eq("tenant_id", tenant.id)
		.eq("agent", "outreach")
		.maybeSingle();
	if (agentError)
		console.error("outreach settings: tenant_agents:", agentError);
	// Sin el agente habilitado no hay nada que configurar acá.
	if (!agentError && agent?.enabled !== true) notFound();

	// Una config guardada rota no puede dejar al administrador sin pantalla
	// para arreglarla: se muestra el formulario con los defaults.
	let config: ReturnType<typeof parseOutreachConfig>;
	let rawModels: Record<string, string> = {};
	try {
		const raw = (agent?.config as { outreach?: unknown } | null)?.outreach;
		config = parseOutreachConfig(raw);
		rawModels =
			((raw as { models?: Record<string, string> } | null)?.models as
				| Record<string, string>
				| undefined) ?? {};
	} catch (error) {
		console.error("outreach settings: config inválida:", error);
		config = parseOutreachConfig({});
	}

	const resources = budgetResources();
	const since = dayStart(config.timezone, new Date()).toISOString();
	const [valuesResult, workflowsResult, budgetsResult, eventsResult, icp] =
		await Promise.all([
			supabase
				.from("config_values")
				.select("kind, value, label, active, meta")
				.eq("tenant_id", tenant.id),
			supabase
				.from("tenant_workflows")
				.select("workflow, enabled, config, last_run_at")
				.eq("tenant_id", tenant.id),
			supabase.rpc("tenant_budget_status", {
				p_tenant: tenant.id,
				p_resources: resources,
				p_since: since,
			} as never),
			supabase
				.from("events")
				.select("type, payload, created_at")
				.eq("tenant_id", tenant.id)
				.in("type", MARCO_EVENTS)
				.order("created_at", { ascending: false })
				.limit(1),
			brainForTenant(tenant.id)
				.then(loadIcpLevels)
				.catch((error): CanonLoad<IcpLevels> => {
					console.error("outreach settings: brain:", error);
					return { ok: false, reason: "brain_caido", errors: [] };
				}),
		]);
	for (const [name, result] of [
		["config_values", valuesResult],
		["tenant_workflows", workflowsResult],
		["tenant_budget_status", budgetsResult],
		["events", eventsResult],
	] as const) {
		if (result.error)
			console.error(`outreach settings: ${name}:`, result.error);
	}

	const values = toListValues(valuesResult.data ?? []);
	const budgets = toBudgetRows((budgetsResult.data as unknown[] | null) ?? []);
	const lastEvent = eventsResult.data?.[0];
	const lastFailure =
		lastEvent?.type === "outreach.marco_reflect_failed"
			? {
					at: lastEvent.created_at as string,
					errors: ((lastEvent.payload as { errors?: unknown } | null)?.errors as
						| string[]
						| undefined) ?? ["No pude leer el brain."],
				}
			: null;

	return (
		<div className="max-w-3xl space-y-10">
			<section>
				<Link
					className="text-sm underline underline-offset-4"
					href={`/${slug}/settings`}
				>
					← Configuración
				</Link>
				<h1 className="mt-2 mb-4 text-3xl leading-tight">Outreach</h1>
				<h2 className="mb-3 text-lg">Cliente ideal (ICP)</h2>
				<IcpSummary icp={icp} slug={slug} />
			</section>

			<section>
				<h2 className="mb-3 text-lg">Hooks y vectores</h2>
				{valuesResult.error ? (
					<Unreadable />
				) : (
					<MarcoSummary lastFailure={lastFailure} slug={slug} values={values} />
				)}
			</section>

			<section>
				<h2 className="mb-3 text-lg">Segmentos e idiomas</h2>
				{valuesResult.error ? (
					<Unreadable />
				) : (
					<ListsSection
						idiomas={SUPPORTED_IDIOMAS}
						slug={slug}
						values={values}
					/>
				)}
			</section>

			<section>
				<h2 className="mb-3 text-lg">Datos de outreach</h2>
				{agentError ? (
					<Unreadable />
				) : (
					<OutreachConfigForm
						allowedModels={tenant.allowedModels}
						defaults={DEFAULT_OUTREACH_MODELS}
						initial={{
							timezone: config.timezone,
							bcc: config.bcc ?? "",
							dealPipeline: config.deal?.pipeline ?? "",
							dealStage: config.deal?.stage ?? "",
							companyName: config.company?.name ?? "",
							companyUrl: config.company?.url ?? "",
							models: rawModels,
						}}
						slug={slug}
					/>
				)}
			</section>

			<section>
				<h2 className="mb-3 text-lg">Procesos automáticos</h2>
				{workflowsResult.error || budgetsResult.error ? (
					<Unreadable />
				) : (
					<WorkflowsSection
						slug={slug}
						timezone={config.timezone}
						workflows={workflowRows(workflowsResult.data ?? [], budgets)}
					/>
				)}
			</section>

			<section>
				<h2 className="mb-3 text-lg">Presupuesto de hoy</h2>
				{budgetsResult.error ? (
					<Unreadable />
				) : (
					<BudgetSummary budgets={budgets} />
				)}
			</section>
		</div>
	);
}
