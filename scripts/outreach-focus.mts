// Crea un foco de búsqueda desde la CLI, hasta que exista /focos (E4).
// Uso: npm run outreach:focus -- --tenant innovas --owner mati --file foco.json [--apply]
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { parseFocusArgs } from "./outreach-focus-args.ts";

const args = parseFocusArgs(process.argv.slice(2));
const admin = createClient(
	process.env.NEXT_PUBLIC_SUPABASE_URL as string,
	process.env.SUPABASE_SERVICE_ROLE_KEY as string,
	{ auth: { persistSession: false } },
);

const payload = JSON.parse(readFileSync(args.file, "utf8"));

const { data: tenant } = await admin
	.from("tenants")
	.select("id")
	.eq("slug", args.tenant)
	.single();
if (!tenant) throw new Error(`no existe el tenant ${args.tenant}`);

const { data: executor } = await admin
	.from("executors")
	.select("user_id")
	.eq("tenant_id", tenant.id)
	.eq("slug", args.owner)
	.single();
if (!executor) throw new Error(`no existe el ejecutor ${args.owner}`);

// Las listas cerradas se validan contra config_values, igual que el resto.
const { data: values } = await admin
	.from("config_values")
	.select("kind, value")
	.eq("tenant_id", tenant.id)
	.eq("active", true);
for (const [kind, value] of [
	["vector", payload.vector],
	["segmento", payload.segment],
	["hook", payload.hook],
	["idioma", payload.idioma],
] as const) {
	const ok = (values ?? []).some(
		(row) => row.kind === kind && row.value === value,
	);
	if (!ok)
		throw new Error(
			`${kind} "${value}" no está en config_values de ${args.tenant}`,
		);
}

const row = {
	tenant_id: tenant.id,
	created_by: executor.user_id,
	name: payload.name,
	criteria: payload.criteria,
	vector: payload.vector,
	segment: payload.segment,
	hook: payload.hook,
	idioma: payload.idioma,
	max_accounts: payload.maxAccounts,
	max_contacts: payload.maxContacts,
};

if (!args.apply) {
	console.log("Sin --apply. Se crearía este foco:");
	console.log(JSON.stringify(row, null, 2));
	process.exit(0);
}

const { data, error } = await admin
	.from("search_focuses")
	.insert(row)
	.select("id")
	.single();
if (error) throw new Error(error.message);
console.log(`foco creado: ${data.id}`);
