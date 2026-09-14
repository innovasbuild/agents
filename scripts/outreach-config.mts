// Carga de listas y configuración de outreach de un tenant (spec 03 §4.3).
// Sin --apply solo muestra el plan. Uso:
//   npm run outreach:config -- --tenant innovas [--apply]
import { readFile } from "node:fs/promises";
import { userInfo } from "node:os";
import { createClient } from "@supabase/supabase-js";
import {
	type ConfigValueRow,
	outreachFileSchema,
	planConfigValues,
} from "../lib/outreach/config.ts";
import { parseOutreachConfigArgs } from "./outreach-config-args.ts";

async function main(): Promise<void> {
	const args = parseOutreachConfigArgs(process.argv.slice(2));
	const file = outreachFileSchema.parse(
		JSON.parse(await readFile(`tenants/${args.tenant}/outreach.json`, "utf8")),
	);

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

	const { data: agentRow, error: agentError } = await admin
		.from("tenant_agents")
		.select("config")
		.eq("tenant_id", tenant.id)
		.eq("agent", "outreach")
		.maybeSingle();
	if (agentError)
		throw new Error(`no pude leer tenant_agents: ${agentError.message}`);
	if (!agentRow)
		throw new Error(
			`el tenant "${args.tenant}" no tiene el agente outreach en tenant_agents`,
		);

	const { data: rows, error: rowsError } = await admin
		.from("config_values")
		.select("id, kind, value, label, active, meta")
		.eq("tenant_id", tenant.id);
	if (rowsError)
		throw new Error(`no pude leer config_values: ${rowsError.message}`);

	const plan = planConfigValues((rows ?? []) as ConfigValueRow[], file);
	for (const item of plan.upserts)
		console.log(`+ ${item.kind} ${item.value} (${item.label})`);
	for (const row of plan.deactivate)
		console.log(`- ${row.kind} ${row.value} (se desactiva)`);
	console.log(`= ${plan.unchanged} sin cambios`);
	const currentConfig = (agentRow.config ?? {}) as Record<string, unknown>;
	console.log(
		`config.outreach: ${JSON.stringify(currentConfig.outreach ?? null)} → ${JSON.stringify(file.config)}`,
	);

	if (!args.apply) {
		console.log("plan solamente: corré de nuevo con --apply para escribir");
		return;
	}

	const now = new Date().toISOString();
	if (plan.upserts.length > 0) {
		const { error } = await admin.from("config_values").upsert(
			plan.upserts.map((item) => ({
				tenant_id: tenant.id,
				...item,
				active: true,
				updated_at: now,
			})),
			{ onConflict: "tenant_id,kind,value" },
		);
		if (error)
			throw new Error(`no pude guardar config_values: ${error.message}`);
	}
	if (plan.deactivate.length > 0) {
		const { error } = await admin
			.from("config_values")
			.update({ active: false, updated_at: now })
			.in(
				"id",
				plan.deactivate.map((row) => row.id),
			);
		if (error)
			throw new Error(`no pude desactivar config_values: ${error.message}`);
	}
	const { error: configError } = await admin
		.from("tenant_agents")
		.update({ config: { ...currentConfig, outreach: file.config } })
		.eq("tenant_id", tenant.id)
		.eq("agent", "outreach");
	if (configError)
		throw new Error(
			`no pude guardar tenant_agents.config: ${configError.message}`,
		);

	const { error: eventError } = await admin.from("events").insert({
		tenant_id: tenant.id,
		type: "outreach.config_applied",
		summary: `${plan.upserts.length} altas o cambios, ${plan.deactivate.length} bajas`,
		payload: {
			upserts: plan.upserts.length,
			deactivated: plan.deactivate.length,
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
