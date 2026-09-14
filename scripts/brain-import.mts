// Import de una carpeta de markdown al brain wiki de un tenant (spec brain §9).
// Dry-run por defecto. Uso:
//   npm run brain:import -- --tenant innovas --from "<carpeta>"
//   npm run brain:import -- --tenant innovas --from "<carpeta>" --apply
// Contra producción lo corre el usuario con un env file de producción:
//   node --env-file=<archivo> scripts/brain-import.mts --tenant innovas --from "<carpeta>" --apply
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";
import { parseWikiConfig } from "../lib/brain/config.ts";
import { readVaultFiles } from "../lib/brain/import/files.ts";
import { parseManifest } from "../lib/brain/import/manifest.ts";
import {
	buildImportPlan,
	type ExistingPage,
	formatImportReport,
} from "../lib/brain/import/plan.ts";
import { createWikiProvider } from "../lib/brain/wiki.ts";
import { createSupabaseWikiStore } from "../lib/brain/wiki-store.ts";
import { parseImportArgs } from "./brain-import-args.ts";

// Raíz del repo relativa a este script (no a process.cwd()): así el import
// funciona invocado desde cualquier directorio, no solo desde la raíz.
const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));

async function readJson(path: string): Promise<unknown> {
	try {
		return JSON.parse(await readFile(path, "utf8"));
	} catch (error) {
		throw new Error(
			`no pude leer ${path}: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
}

async function main(): Promise<void> {
	const args = parseImportArgs(process.argv.slice(2));

	const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
	const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
	if (!url || !key)
		throw new Error(
			"faltan NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY",
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

	const { data: binding, error: bindingError } = await admin
		.from("tenant_connections")
		.select("id, config")
		.eq("tenant_id", tenant.id)
		.eq("capability", "brain")
		.eq("provider", "wiki")
		.eq("enabled", true)
		.maybeSingle();
	if (bindingError)
		throw new Error(`no pude leer el binding: ${bindingError.message}`);
	if (!binding) {
		throw new Error(
			`${args.tenant} no tiene binding brain/wiki: corré npm run connections:bind primero`,
		);
	}
	const config = parseWikiConfig(binding.config);

	const manifest = parseManifest(
		await readJson(
			join(REPO_ROOT, "tenants", args.tenant, "brain-import.json"),
		),
	);
	const files = await readVaultFiles(args.from);

	const { data: pages, error: pagesError } = await admin
		.from("brain_pages")
		.select("slug, revision, source_hash, source_revision")
		.eq("tenant_id", tenant.id)
		.range(0, 9999);
	if (pagesError)
		throw new Error(
			`no pude leer las páginas existentes: ${pagesError.message}`,
		);
	const existing: ExistingPage[] = (pages ?? []).map((page) => ({
		slug: page.slug,
		revision: page.revision,
		sourceHash: page.source_hash,
		sourceRevision: page.source_revision,
	}));

	const plan = buildImportPlan({
		files,
		manifest,
		config,
		existing,
		force: args.force,
		today: new Date().toISOString().slice(0, 10),
	});
	console.log(formatImportReport(plan));

	if (!args.apply) {
		console.log(
			"\ndry-run: no se escribió nada. Repetí con --apply para escribir.",
		);
		return;
	}
	if (plan.blocking)
		throw new Error("hay errores bloqueantes: no se escribió nada");

	const provider = createWikiProvider({
		tenantId: tenant.id,
		bindingId: binding.id,
		config,
		store: createSupabaseWikiStore(admin),
	});

	let written = 0;
	const failures: string[] = [];
	for (const entry of plan.entries) {
		if (
			!entry.draft ||
			(entry.action !== "crear" && entry.action !== "actualizar")
		)
			continue;
		const draft = entry.draft;
		try {
			await provider.upsert(
				{
					slug: draft.slug,
					title: draft.title,
					category: draft.category,
					status: draft.status,
					tags: draft.tags,
					frontmatter: draft.frontmatter,
					body: draft.body,
					reason: `import desde ${draft.sourcePath}`,
					...(entry.baseRevision === null
						? {}
						: { baseRevision: entry.baseRevision }),
				},
				{
					kind: "import",
					userId: null,
					sourcePath: draft.sourcePath,
					sourceHash: draft.sourceHash,
				},
			);
			written += 1;
		} catch (error) {
			failures.push(
				`${draft.slug}: ${error instanceof Error ? error.message : String(error)}`,
			);
		}
	}

	console.log(`\nescritas: ${written}`);
	if (failures.length > 0) {
		console.error(
			`fallaron ${failures.length} (volvé a correr el import para reintentar):`,
		);
		for (const failure of failures) console.error(`  ${failure}`);
		process.exitCode = 1;
	}
}

main().catch((error: unknown) => {
	console.error(error instanceof Error ? error.message : error);
	process.exit(1);
});
