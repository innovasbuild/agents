// Alta de un binding de conector para un tenant (spec 02 §9). No maneja
// secretos: la llave ya está en Vercel Connect. Uso:
//   npm run connections:bind -- --tenant innovas --capability leads \
//     --provider coldiq --connector innovas-coldiq
//   npm run connections:bind -- --tenant innovas --capability brain --provider wiki --config tenants/innovas/brain.json
import { userInfo } from "node:os";
import { createClient } from "@supabase/supabase-js";
import { parseBindArgs } from "./connections-bind-args.ts";
import { loadProviderConfig } from "./connections-bind-config.ts";
import { describeBindError } from "./connections-bind-errors.ts";

async function main(): Promise<void> {
	const args = parseBindArgs(process.argv.slice(2));

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

	const { data: binding, error: bindError } = await admin
		.from("tenant_connections")
		.upsert(
			{
				tenant_id: tenant.id,
				capability: args.capability,
				provider: args.provider,
				connector_uid: args.connector,
				config: args.configPath
					? await loadProviderConfig(args.provider, args.configPath)
					: {},
				enabled: true,
				updated_at: new Date().toISOString(),
			},
			{ onConflict: "tenant_id,capability,provider" },
		)
		.select("id")
		.single();
	if (bindError) {
		const { data: enabled } = await admin
			.from("tenant_connections")
			.select("provider")
			.eq("tenant_id", tenant.id)
			.eq("capability", "brain")
			.eq("enabled", true)
			.maybeSingle();
		throw new Error(describeBindError(bindError, enabled?.provider ?? null));
	}

	const { error: eventError } = await admin.from("events").insert({
		tenant_id: tenant.id,
		type: "connection.bound",
		summary: `${args.capability}/${args.provider}`,
		payload: {
			capability: args.capability,
			provider: args.provider,
			connector_uid: args.connector,
			binding_id: binding.id,
			actor: `script:${userInfo().username}`,
		},
	});
	if (eventError)
		throw new Error(
			`el binding quedó guardado pero no el evento: ${eventError.message}`,
		);

	console.log(
		`listo: ${args.tenant} ${args.capability}/${args.provider} (binding ${binding.id})`,
	);
}

main().catch((error: unknown) => {
	console.error(error instanceof Error ? error.message : error);
	process.exit(1);
});
