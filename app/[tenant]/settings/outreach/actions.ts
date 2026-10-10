"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import {
	DEFAULT_OUTREACH_MODELS,
	outreachConfigSchema,
	SUPPORTED_IDIOMAS,
} from "@/lib/outreach/config";
import { reflectMarcoForTenant } from "@/lib/outreach/marco-reflect";
import { isWorkflow, WORKFLOWS } from "@/lib/workflows/registry";
import {
	adminOf,
	type ConfigResult,
	fromDbError,
	INVALIDO,
} from "../action-helpers";

type Admin = Exclude<Awaited<ReturnType<typeof adminOf>>, ConfigResult>;

export type OutreachConfigInput = {
	timezone: string;
	bcc: string;
	dealPipeline: string;
	dealStage: string;
	companyName: string;
	companyUrl: string;
	models: Record<string, string>;
};

async function call(
	slug: string,
	admin: Admin,
	fn: "set_list_value" | "set_outreach_config" | "set_workflow",
	args: Record<string, unknown>,
): Promise<ConfigResult> {
	// rpc() no valida nombre ni argumentos contra los tipos en este repo: los
	// tests de esta acción afirman ambos.
	const { error } = await admin.supabase.rpc(fn, args as never);
	if (error) return fromDbError(error);
	revalidatePath(`/${slug}/settings/outreach`);
	return { ok: true };
}

const fail = (message: string): ConfigResult => ({ ok: false, message });

const listSchema = z.object({
	kind: z.enum(["segmento", "idioma"]),
	value: z.string().min(1).max(61),
	label: z.string().trim().min(1).max(200),
	active: z.boolean(),
});

export async function saveListValue(
	slug: string,
	kind: string,
	value: string,
	label: string,
	active: boolean,
): Promise<ConfigResult> {
	if (kind === "hook" || kind === "vector") {
		return fail("Los hooks y vectores se editan en el brain.");
	}
	const parsed = listSchema.safeParse({ kind, value, label, active });
	if (!parsed.success) return INVALIDO;
	if (
		parsed.data.kind === "idioma" &&
		!(SUPPORTED_IDIOMAS as readonly string[]).includes(parsed.data.value)
	) {
		return fail("Ese idioma todavía no está disponible.");
	}

	const admin = await adminOf(slug);
	if ("ok" in admin) return admin;

	return call(slug, admin, "set_list_value", {
		p_tenant: admin.tenantId,
		p_kind: parsed.data.kind,
		p_value: parsed.data.value,
		p_label: parsed.data.label,
		p_active: parsed.data.active,
	});
}

const text = z.string().max(300);
const inputSchema = z.object({
	timezone: text,
	bcc: text,
	dealPipeline: text,
	dealStage: text,
	companyName: text,
	companyUrl: text,
	models: z.record(z.string(), text),
});

const FIELD_MESSAGES: Record<string, string> = {
	timezone: "Revisá la zona horaria.",
	bcc: "Revisá el mail de BCC.",
	company: "Revisá la URL de la empresa.",
	models: "Revisá los modelos.",
	deal: "Revisá el deal.",
};

export async function saveOutreachConfig(
	slug: string,
	input: OutreachConfigInput,
): Promise<ConfigResult> {
	const parsed = inputSchema.safeParse(input);
	if (!parsed.success) return INVALIDO;
	const form = parsed.data;
	const blank = (value: string) => value.trim() === "";

	if (blank(form.dealPipeline) !== blank(form.dealStage)) {
		return fail("El deal necesita pipeline y etapa, o ninguno de los dos.");
	}
	if (blank(form.companyName) !== blank(form.companyUrl)) {
		return fail(
			"La empresa que firma necesita nombre y URL, o ninguno de los dos.",
		);
	}
	const roles = Object.keys(DEFAULT_OUTREACH_MODELS);
	if (Object.keys(form.models).some((role) => !roles.includes(role))) {
		return INVALIDO;
	}
	// Vacío es "usar el default de la plataforma": la clave no viaja.
	const models = Object.fromEntries(
		Object.entries(form.models).filter(([, model]) => !blank(model)),
	);

	// El mismo schema que valida al leer: lo que se guarda siempre se puede leer.
	const config = outreachConfigSchema.safeParse({
		timezone: form.timezone.trim(),
		bcc: blank(form.bcc) ? null : form.bcc.trim(),
		deal: blank(form.dealPipeline)
			? null
			: { pipeline: form.dealPipeline.trim(), stage: form.dealStage.trim() },
		company: blank(form.companyName)
			? null
			: { name: form.companyName.trim(), url: form.companyUrl.trim() },
		models,
	});
	if (!config.success) {
		const field = String(config.error.issues[0]?.path[0] ?? "");
		return fail(FIELD_MESSAGES[field] ?? "Revisá los datos.");
	}

	const admin = await adminOf(slug);
	if ("ok" in admin) return admin;
	if (Object.values(models).some((m) => !admin.allowedModels.includes(m))) {
		return fail("Ese modelo no está entre los permitidos de la empresa.");
	}

	return call(slug, admin, "set_outreach_config", {
		p_tenant: admin.tenantId,
		p_config: config.data,
	});
}

const workflowSchema = z.object({
	enabled: z.boolean(),
	cadenceMinutes: z.number().int(),
	itemsPerTick: z.number().int(),
});

export async function saveWorkflow(
	slug: string,
	workflow: string,
	input: { enabled: boolean; cadenceMinutes: number; itemsPerTick: number },
): Promise<ConfigResult> {
	// El registry vive en código: la base no sabe qué workflows existen ni su tope.
	if (typeof workflow !== "string" || !isWorkflow(workflow)) {
		return fail("Ese proceso no existe.");
	}
	const parsed = workflowSchema.safeParse(input);
	if (!parsed.success) return INVALIDO;
	const max = WORKFLOWS[workflow].caps.itemsPerTick;
	if (parsed.data.itemsPerTick > max) {
		return fail(`Ese proceso admite hasta ${max} por pasada.`);
	}

	const admin = await adminOf(slug);
	if ("ok" in admin) return admin;

	return call(slug, admin, "set_workflow", {
		p_tenant: admin.tenantId,
		p_workflow: workflow,
		p_enabled: parsed.data.enabled,
		p_cadence_minutes: parsed.data.cadenceMinutes,
		p_items_per_tick: parsed.data.itemsPerTick,
	});
}

const REREAD_MESSAGES: Record<string, string> = {
	sin_brain: "La empresa no tiene brain habilitado.",
	brain_caido: "No pude leer el brain. Probá de nuevo.",
	falta:
		"No encontré bloques hooks y vectores en páginas activas con el tag canon:hooks.",
};

/** Relee hooks y vectores del brain de la empresa de la sesión. No recibe
 * contenido del navegador: el reflejo corre con service role, así que el
 * permiso se comprueba acá antes (spec 21.3 §7). */
export async function rereadMarco(slug: string): Promise<ConfigResult> {
	const admin = await adminOf(slug);
	if ("ok" in admin) return admin;

	const result = await reflectMarcoForTenant(admin.tenantId);
	if (!result.ok) {
		return fail(
			result.reason === "invalido"
				? `Los bloques no son válidos: ${result.errors.slice(0, 3).join(" · ")}`
				: (REREAD_MESSAGES[result.reason] ?? "No se pudo releer el brain."),
		);
	}
	revalidatePath(`/${slug}/settings/outreach`);
	return {
		ok: true,
		message: `Listo: ${result.upserts} altas o cambios, ${result.deactivated} bajas, ${result.unchanged} sin cambios.`,
	};
}
