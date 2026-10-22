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
import {
	effectiveResearch,
	effectiveResearchStatus,
} from "@/lib/onboarding/research-status";
import {
	createResearchStore,
	type ResearchRow,
} from "@/lib/onboarding/research-store";
import { COMPANY_LIMITS } from "@/lib/onboarding/services/propose-folders";
import {
	onboardingGate as gate,
	type OnboardingGate,
} from "@/lib/onboarding/step-gate";
import { stepPath } from "@/lib/onboarding/steps";
import { brainForTenant } from "@/lib/outreach/canon";
import { chatAiBlock } from "@/lib/plans/chat-allowance";
import { createServerSupabase } from "@/lib/supabase/server";

// platform_enable_brain_skills agrega la carpeta skills y falla con 20 o más.
const MAX_CONFIRMED_FOLDERS = 19;
const MAX_HINT = 2000;

const NOT_ALLOWED = "No tenés permiso.";

const folderSchema = z.object({
	slug: z.string(),
	name: z.string().trim().min(1).max(60),
	description: z.string().trim().max(MAX_FOLDER_DESCRIPTION),
	restricted: z.boolean(),
});

type Gate = OnboardingGate;

// Cada corrida del research gasta crédito de IA (hasta 10 pasos sobre 8
// páginas). Tope: la inicial más 5 reintentos, contadas en usage_entries.
const RESEARCH_NODE = "onboarding/propose-folders";
const MAX_RESEARCH_RUNS = 6;
const NO_CREDIT =
	"Tu plan no tiene crédito de IA para leer el sitio. Usá las carpetas genéricas y las ajustás después.";
const TOO_MANY =
	"Ya intentamos varias veces. Usá las carpetas genéricas y las ajustás después.";

/** El motivo para no lanzar otra corrida, o null si se puede. */
async function researchRefusal(g: Gate): Promise<string | null> {
	const tenantId = g.access.id;
	if (await chatAiBlock(tenantId)) return NO_CREDIT;
	const { count, error } = await g.admin
		.from("usage_entries")
		.select("id", { count: "exact", head: true })
		.eq("tenant_id", tenantId)
		.eq("node", RESEARCH_NODE);
	if (error) throw new Error(error.message);
	return (count ?? 0) >= MAX_RESEARCH_RUNS ? TOO_MANY : null;
}

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
		if (await researchRefusal(g)) return { ok: false };
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

const BUSY = "Todavía estamos leyendo el sitio. Esperá un momento.";

/** Una corrida en curso no se pisa: cada una gasta crédito de IA. */
async function inFlight(g: Gate): Promise<boolean> {
	const row = await createResearchStore(g.admin).read(g.access.id);
	return !!row && effectiveResearchStatus(row) === "running";
}

export async function retryResearch(
	slug: string,
	hint: string,
): Promise<{ ok: boolean; message?: string }> {
	try {
		const clean = typeof hint === "string" ? hint.trim() : "";
		if (clean.length < 1 || clean.length > MAX_HINT) return { ok: false };
		const g = await gate(slug);
		if (g?.step !== "carpetas") return { ok: false };
		if (await inFlight(g)) return { ok: false, message: BUSY };
		const refusal = await researchRefusal(g);
		if (refusal) return { ok: false, message: refusal };
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
): Promise<{ ok: boolean; message?: string }> {
	try {
		const g = await gate(slug);
		if (g?.step !== "carpetas") return { ok: false };
		if (await inFlight(g)) return { ok: false, message: BUSY };
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
				companySummary:
					row?.result?.company.summary?.slice(0, COMPANY_LIMITS.summary) ??
					null,
			},
			{
				listTopFolders: async (id) => {
					const { data, error } = await g.admin
						.from("brain_folders")
						.select("path")
						.eq("tenant_id", id);
					if (error) throw new Error(error.message);
					return (data ?? [])
						.map((r) => r.path)
						.filter((p) => !p.includes("/"));
				},
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
