// Prende o apaga un workflow para un tenant, ajusta su config y carga su
// presupuesto diario (spec orquestación §10.1 y §10.2). Sin --apply solo
// muestra el plan. Cada cambio aplicado deja su evento. Uso:
//   npm run workflows:set -- --tenant innovas --workflow refresh-fichas \
//     [--enable|--disable] [--cadence 60] [--items 5] [--budget model_usd=1] [--apply]
import { userInfo } from "node:os";
import { createClient } from "@supabase/supabase-js";
import {
	mergeWorkflowConfig,
	parseWorkflowsSetArgs,
} from "./workflows-set-args.ts";

async function main(): Promise<void> {
	const args = parseWorkflowsSetArgs(process.argv.slice(2));

	const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
	const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
	if (!url || !key)
		throw new Error(
			"faltan NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY en .env.local",
		);
	const admin = createClient(url, key, { auth: { persistSession: false } });

	const { data: tenant, error: tenantError } = await admin
		.from("tenants")
		.select("id")
		.eq("slug", args.tenant)
		.maybeSingle();
	if (tenantError)
		throw new Error(`no pude leer el tenant: ${tenantError.message}`);
	if (!tenant) throw new Error(`no existe el tenant "${args.tenant}"`);

	const { data: current, error: currentError } = await admin
		.from("tenant_workflows")
		.select("enabled, config")
		.eq("tenant_id", tenant.id)
		.eq("workflow", args.workflow)
		.maybeSingle();
	if (currentError)
		throw new Error(`no pude leer tenant_workflows: ${currentError.message}`);
	const currentEnabled = (current?.enabled as boolean | undefined) ?? false;
	const currentConfig = (current?.config ?? {}) as Record<string, unknown>;
	const nextEnabled = args.enabled ?? currentEnabled;
	const nextConfig = mergeWorkflowConfig(currentConfig, args);
	console.log(
		`tenant_workflows ${args.tenant}/${args.workflow}${current ? "" : " (fila nueva)"}: enabled ${currentEnabled} → ${nextEnabled}; config ${JSON.stringify(currentConfig)} → ${JSON.stringify(nextConfig)}`,
	);

	let currentLimit: number | null = null;
	if (args.budget) {
		const { data: row, error } = await admin
			.from("tenant_budgets")
			.select("daily_limit")
			.eq("tenant_id", tenant.id)
			.eq("resource", args.budget.resource)
			.maybeSingle();
		if (error) throw new Error(`no pude leer tenant_budgets: ${error.message}`);
		currentLimit = row ? Number(row.daily_limit) : null;
		console.log(
			`tenant_budgets ${args.budget.resource}: ${currentLimit ?? "sin fila (límite 0)"} → ${args.budget.dailyLimit} por día`,
		);
	}

	if (!args.apply) {
		console.log("plan solamente: corré de nuevo con --apply para escribir");
		return;
	}

	const { error: workflowError } = await admin.from("tenant_workflows").upsert(
		{
			tenant_id: tenant.id,
			workflow: args.workflow,
			enabled: nextEnabled,
			config: nextConfig,
		},
		{ onConflict: "tenant_id,workflow" },
	);
	if (workflowError)
		throw new Error(
			`no pude guardar tenant_workflows: ${workflowError.message}`,
		);

	if (args.budget) {
		const { error } = await admin.from("tenant_budgets").upsert(
			{
				tenant_id: tenant.id,
				resource: args.budget.resource,
				daily_limit: args.budget.dailyLimit,
				updated_by: null,
				updated_at: new Date().toISOString(),
			},
			{ onConflict: "tenant_id,resource" },
		);
		if (error)
			throw new Error(`no pude guardar tenant_budgets: ${error.message}`);
	}

	const { error: eventError } = await admin.from("events").insert({
		tenant_id: tenant.id,
		type: "workflows.config_applied",
		summary: `${args.workflow}: enabled ${nextEnabled}${args.budget ? `, ${args.budget.resource} ${args.budget.dailyLimit}/día` : ""}`,
		payload: {
			workflow: args.workflow,
			enabled: { from: currentEnabled, to: nextEnabled },
			config: { from: currentConfig, to: nextConfig },
			budget: args.budget
				? {
						resource: args.budget.resource,
						from: currentLimit,
						to: args.budget.dailyLimit,
					}
				: null,
			actor: `script:${userInfo().username}`,
		},
	});
	if (eventError)
		throw new Error(
			`la configuración quedó guardada pero no el evento: ${eventError.message}`,
		);
	console.log("listo");
}

main().catch((error: unknown) => {
	console.error(error instanceof Error ? error.message : error);
	process.exit(1);
});
