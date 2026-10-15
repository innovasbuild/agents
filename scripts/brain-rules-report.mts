// Reporte en seco de las páginas reservadas antes de desplegar la 26.2 (spec
// etapa 26 §4.1). Solo lee: únicamente SELECT. Sin --tenant recorre todas.
//   npm run brain:rules-report
//   npm run brain:rules-report -- --tenant okeefe
// Contra producción lo corre una persona con un env file de producción:
//   node --env-file=<archivo> scripts/brain-rules-report.mts
import { createClient } from "@supabase/supabase-js";
import { fetchAllRows } from "../lib/brain/core/folders-report.ts";
import {
	type ReportPage,
	renderRulesReport,
	type TenantReservedPages,
} from "../lib/brain/core/rules-report.ts";

const flag = process.argv.indexOf("--tenant");
const only = flag === -1 ? null : process.argv[flag + 1];
if (flag !== -1 && !only) {
	console.error("Uso: npm run brain:rules-report [-- --tenant <slug>]");
	process.exit(1);
}
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
	console.error("Faltan NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY.");
	process.exit(1);
}
const db = createClient(url, key, { auth: { persistSession: false } });

function fail(what: string, error: { message?: string } | null): never {
	console.error(`No pude ${what}: ${error?.message ?? "error desconocido"}.`);
	process.exit(1);
}

let query = db.from("tenants").select("id, slug").order("slug");
if (only) query = query.eq("slug", only);
const { data: tenants, error: tenantsError } = await query;
if (tenantsError) fail("leer los tenants", tenantsError);
if (!tenants || tenants.length === 0) {
	console.error(only ? `No existe el tenant ${only}.` : "No hay tenants.");
	process.exit(1);
}

const loaded: TenantReservedPages[] = [];
for (const tenant of tenants) {
	const { data: binding, error: bindingError } = await db
		.from("tenant_connections")
		.select("id")
		.eq("tenant_id", tenant.id)
		.eq("capability", "brain")
		.eq("provider", "wiki")
		.maybeSingle();
	if (bindingError) fail(`leer el brain de ${tenant.slug}`, bindingError);
	// Un tenant sin brain no tiene páginas que reservar.
	if (!binding) continue;
	const pages: ReportPage[] = [];
	for (const leaf of ["00-reglas", "00-plantilla"]) {
		// PostgREST corta en 1000 filas: se pagina y se compara con el conteo exacto.
		const rows = await fetchAllRows(async (from, to) => {
			const { data, error } = await db
				.from("brain_pages")
				.select("slug, status, body")
				.eq("tenant_id", tenant.id)
				.like("slug", `%${leaf}%`)
				.order("slug")
				.range(from, to);
			if (error) fail(`leer las páginas ${leaf} de ${tenant.slug}`, error);
			return (data ?? []) as ReportPage[];
		});
		const { count, error: countError } = await db
			.from("brain_pages")
			.select("slug", { count: "exact", head: true })
			.eq("tenant_id", tenant.id)
			.like("slug", `%${leaf}%`);
		if (countError)
			fail(`contar las páginas ${leaf} de ${tenant.slug}`, countError);
		if (count !== rows.length) {
			console.error(
				`Leí ${rows.length} páginas ${leaf} de ${tenant.slug} pero hay ${count}. El reporte no es confiable; no lo uses.`,
			);
			process.exit(1);
		}
		for (const row of rows)
			if (!pages.some((p) => p.slug === row.slug)) pages.push(row);
	}
	loaded.push({ tenant: tenant.slug, pages });
}

console.log(renderRulesReport(loaded).text);
