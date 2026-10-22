"use server";

import { redirect } from "next/navigation";
import { after } from "next/server";
import { z } from "zod";
import { BrainConflict } from "@/lib/brain/core/errors";
import {
	categoryForPath,
	MAX_FOLDER_DESCRIPTION,
	validateFolderPath,
} from "@/lib/brain/core/folders";
import { GENERIC_FOLDERS } from "@/lib/onboarding/folder-template";
import {
	type ConfirmedFolder,
	setupBrainFolders,
} from "@/lib/onboarding/folders-setup";
import { folderResearchDeps } from "@/lib/onboarding/research-deps";
import { runFolderResearch } from "@/lib/onboarding/research-run";
import { effectiveResearch } from "@/lib/onboarding/research-status";
import {
	createResearchStore,
	type ResearchRow,
} from "@/lib/onboarding/research-store";
import { stepPath } from "@/lib/onboarding/steps";
import { brainForTenant } from "@/lib/outreach/canon";
import { createAdminClient } from "@/lib/supabase/admin";
import { createServerSupabase } from "@/lib/supabase/server";
import { resolveTenantAccess } from "@/lib/tenants/resolve";

// Por defecto de la columna tenants.default_model, si no se pudo leer.
const FALLBACK_MODEL = "anthropic/claude-sonnet-5";
// platform_enable_brain_skills agrega la carpeta skills y falla con 20 o más.
const MAX_CONFIRMED_FOLDERS = 19;
const MAX_HINT = 2000;

const SLUG = /^[a-z0-9-]{1,63}$/;
const NOT_ALLOWED = "No tenés permiso.";

const folderSchema = z.object({
	slug: z.string(),
	name: z.string().trim().min(1).max(60),
	description: z.string().trim().max(MAX_FOLDER_DESCRIPTION),
	restricted: z.boolean(),
});

/** La empresa sale del slug resuelto con la sesión; nunca el id del navegador. */
async function gate(slug: string) {
	if (!SLUG.test(slug)) return null;
	const access = await resolveTenantAccess(slug);
	if (!access || access.role === "tenant_member") return null;
	const admin = createAdminClient();
	const { data, error } = await admin
		.from("tenants")
		.select("onboarding_step, allowed_domains, default_model")
		.eq("id", access.id)
		.single();
	if (error || !data) return null;
	return {
		access,
		admin,
		step: data.onboarding_step as string | null,
		domain: data.allowed_domains?.[0] ?? "",
		model: data.default_model || access.defaultModel || FALLBACK_MODEL,
	};
}

type Gate = NonNullable<Awaited<ReturnType<typeof gate>>>;

function scheduleResearch(g: Gate, hint: string | null) {
	const input = {
		tenantId: g.access.id,
		domain: g.domain,
		displayName: g.access.displayName,
		hint,
		model: g.model,
	};
	after(async () => {
		try {
			await runFolderResearch(input, folderResearchDeps(input.tenantId));
		} catch (error) {
			console.error("runFolderResearch falló", input.tenantId, error);
		}
	});
}

/** Para el polling del cliente. Un `running` viejo se lee como error. */
export async function readResearch(slug: string): Promise<ResearchRow | null> {
	try {
		const g = await gate(slug);
		if (!g) return null;
		const row = await createResearchStore(g.admin).read(g.access.id);
		return row ? effectiveResearch(row) : null;
	} catch (error) {
		console.error("readResearch falló", error);
		return null;
	}
}

/**
 * Arranca el research si todavía no hay fila (el paso anterior pudo no
 * agendarlo). Idempotente: la fila se reclama con un insert que ignora
 * duplicados, así que dos llamadas juntas no lanzan dos corridas.
 */
export async function ensureResearch(slug: string): Promise<{ ok: boolean }> {
	try {
		const g = await gate(slug);
		if (g?.step !== "carpetas") return { ok: false };
		const tenantId = g.access.id;
		if (await createResearchStore(g.admin).read(tenantId)) return { ok: true };
		const { data, error } = await g.admin
			.from("onboarding_research")
			.upsert(
				{
					tenant_id: tenantId,
					status: "running",
					hint: null,
					result: null,
					error: null,
					updated_at: new Date().toISOString(),
				},
				{ onConflict: "tenant_id", ignoreDuplicates: true },
			)
			.select("tenant_id");
		if (error) throw new Error(error.message);
		if (data && data.length > 0) scheduleResearch(g, null);
		return { ok: true };
	} catch (error) {
		console.error("ensureResearch falló", error);
		return { ok: false };
	}
}

export async function retryResearch(
	slug: string,
	hint: string,
): Promise<{ ok: boolean }> {
	try {
		const clean = typeof hint === "string" ? hint.trim() : "";
		if (clean.length < 1 || clean.length > MAX_HINT) return { ok: false };
		const g = await gate(slug);
		if (g?.step !== "carpetas") return { ok: false };
		await createResearchStore(g.admin).start(g.access.id, clean);
		scheduleResearch(g, clean);
		return { ok: true };
	} catch (error) {
		console.error("retryResearch falló", error);
		return { ok: false };
	}
}

export async function useGenericFolders(
	slug: string,
): Promise<{ ok: boolean }> {
	try {
		const g = await gate(slug);
		if (g?.step !== "carpetas") return { ok: false };
		await createResearchStore(g.admin).finish(g.access.id, {
			found: true,
			company: {
				summary: "",
				industry: "",
				sizeHint: null,
				location: null,
				products: [],
			},
			brand: { colors: [], fonts: [], logoUrl: null },
			folders: GENERIC_FOLDERS,
		});
		return { ok: true };
	} catch (error) {
		console.error("useGenericFolders falló", error);
		return { ok: false };
	}
}

type ConfirmResult = { ok: true } | { ok: false; message: string };
const fail = (message: string) => ({ ok: false as const, message });

function validate(
	input: unknown,
): { ok: true; folders: ConfirmedFolder[] } | { ok: false; message: string } {
	const parsed = z.array(folderSchema).safeParse(input);
	if (!parsed.success)
		return fail("Revisá los nombres y las descripciones de las carpetas.");
	const folders = parsed.data;
	if (folders.length < 1) return fail("Dejá al menos una carpeta.");
	if (folders.length > MAX_CONFIRMED_FOLDERS)
		return fail(`Podés crear hasta ${MAX_CONFIRMED_FOLDERS} carpetas.`);
	const seen = new Set<string>();
	for (const f of folders) {
		const slugOk = validateFolderPath(f.slug);
		if (!slugOk.ok || f.slug !== f.slug.toLowerCase())
			return fail(
				slugOk.ok
					? "Usá minúsculas, números y guiones en el nombre de las carpetas."
					: slugOk.message,
			);
		if (f.slug.includes("/"))
			return fail("Las carpetas de este paso son de primer nivel.");
		if (seen.has(f.slug)) return fail("Hay dos carpetas con el mismo nombre.");
		seen.add(f.slug);
	}
	return { ok: true, folders };
}

export async function confirmFolders(
	slug: string,
	folders: ConfirmedFolder[],
): Promise<ConfirmResult> {
	const checked = validate(folders);
	if (!checked.ok) return checked;

	let done = false;
	try {
		const g = await gate(slug);
		if (!g) return fail(NOT_ALLOWED);
		if (g.step !== "carpetas")
			return fail("Este paso ya está hecho. Recargá la página.");
		const tenantId = g.access.id;
		const row = await createResearchStore(g.admin).read(tenantId);
		const result = await setupBrainFolders(
			{
				tenantId,
				actorUserId: g.access.userId,
				displayName: g.access.displayName,
				folders: checked.folders,
				companySummary: row?.result?.company.summary ?? null,
			},
			{
				rpc: async (fn, args) => g.admin.rpc(fn as never, args as never),
				upsertPage: async (write, author) => {
					const brain = await brainForTenant(tenantId);
					if (!brain) throw new Error("el brain no está disponible");
					try {
						await brain.upsert(
							{
								...write,
								category:
									write.slug === "00-reglas"
										? "brain"
										: categoryForPath(write.slug),
								tags: [],
								reason: "Página inicial al crear la empresa",
							},
							author,
						);
					} catch (error) {
						if (error instanceof BrainConflict) return;
						throw error;
					}
				},
			},
		);
		if (!result.ok) {
			console.error("confirmFolders: falló", tenantId, result);
			return fail("No pudimos armar tu brain. Probá de nuevo.");
		}
		const supabase = await createServerSupabase();
		const { error } = await supabase.rpc("set_onboarding_step", {
			p_tenant: tenantId,
			p_step: "logo",
		});
		if (error) {
			console.error("set_onboarding_step falló", tenantId, error);
			return fail("No pudimos avanzar al paso siguiente. Probá de nuevo.");
		}
		done = true;
	} catch (error) {
		console.error("confirmFolders falló", error);
		return fail("No pudimos armar tu brain. Probá de nuevo.");
	}
	// Fuera del try: redirect() tira y un catch lo taparía.
	if (done) redirect(stepPath(slug, "logo"));
	return fail("No pudimos armar tu brain. Probá de nuevo.");
}
