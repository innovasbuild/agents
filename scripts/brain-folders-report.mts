// Reporte en seco de la migración de carpetas (spec etapa 26 §3.4). Solo lee:
// únicamente SELECT, nunca escribe. Sin --tenant recorre todas las empresas.
//   npm run brain:folders-report
//   npm run brain:folders-report -- --tenant okeefe
// Contra producción lo corre una persona con un env file de producción:
//   node --env-file=<archivo> scripts/brain-folders-report.mts
// Sale con código 2 si algún slug abortaría la migración.
import { createClient } from "@supabase/supabase-js";
import {
	fetchAllRows,
	renderFolderReport,
	type TenantPages,
} from "../lib/brain/core/folders-report.ts";

const flag = process.argv.indexOf("--tenant");
const only = flag === -1 ? null : process.argv[flag + 1];
if (flag !== -1 && !only) {
	console.error("Uso: npm run brain:folders-report [-- --tenant <slug>]");
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

const loaded: TenantPages[] = [];
for (const tenant of tenants) {
	const { data: binding, error: bindingError } = await db
		.from("tenant_connections")
		.select("config")
		.eq("tenant_id", tenant.id)
		.eq("capability", "brain")
		.eq("provider", "wiki")
		.maybeSingle();
	if (bindingError) fail(`leer el brain de ${tenant.slug}`, bindingError);
	// Un tenant sin brain no entra en el backfill.
	if (!binding) continue;
	// PostgREST corta en 1000 filas: se pagina y se compara con el conteo exacto.
	const pages = await fetchAllRows(async (from, to) => {
		const { data, error } = await db
			.from("brain_pages")
			.select("slug, category")
			.eq("tenant_id", tenant.id)
			.order("slug")
			.range(from, to);
		if (error) fail(`leer las páginas de ${tenant.slug}`, error);
		return data ?? [];
	});
	const { count, error: countError } = await db
		.from("brain_pages")
		.select("slug", { count: "exact", head: true })
		.eq("tenant_id", tenant.id);
	if (countError) fail(`contar las páginas de ${tenant.slug}`, countError);
	if (count !== pages.length) {
		console.error(
			`Leí ${pages.length} páginas de ${tenant.slug} pero hay ${count}. El reporte no es confiable; no lo uses.`,
		);
		process.exit(1);
	}
	loaded.push({
		tenant: tenant.slug,
		categories:
			(binding.config as { categories?: string[] } | null)?.categories ?? [],
		pages,
	});
}

const report = renderFolderReport(loaded);
console.log(report.text);
if (report.blocked) process.exitCode = 2;
