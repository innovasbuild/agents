"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { mergeBrand, validateLogo } from "@/lib/tenants/tenant-form";
import {
	adminOf,
	fromDbError,
	GENERICO,
	INVALIDO,
	type Supabase,
} from "./action-helpers";
import type { SettingsResult } from "./actions";

// Las tres escrituras pasan por funciones security definer (set_tenant_profile,
// set_tenant_auth_methods, set_ai_monthly_limit): tenants_guard_columns le cierra
// estas columnas al administrador. Las usan Configuración y el alta (/empezar).

const COLOR = /^#[0-9a-fA-F]{6}$/;
const color = z.string().refine((v) => v === "" || COLOR.test(v));
const profileSchema = z.object({
	displayName: z.string().trim().min(1).max(80),
	primary: color,
	secondary: color,
});

async function currentProfile(supabase: Supabase, tenantId: string) {
	const { data, error } = await supabase
		.from("tenants")
		.select("display_name, brand")
		.eq("id", tenantId)
		.single();
	if (error || !data) return null;
	return {
		displayName: data.display_name,
		brand: (data.brand ?? {}) as Record<string, unknown>,
	};
}

async function writeProfile(
	slug: string,
	supabase: Supabase,
	tenantId: string,
	displayName: string,
	brand: Record<string, unknown>,
): Promise<SettingsResult> {
	const { error } = await supabase.rpc("set_tenant_profile", {
		p_tenant: tenantId,
		p_display_name: displayName,
		p_brand: brand as never,
	});
	if (error) return fromDbError(error);
	revalidatePath(`/${slug}/settings`);
	revalidatePath(`/${slug}`, "layout");
	return { ok: true };
}

export async function saveProfile(
	slug: string,
	input: { displayName: string; primary: string; secondary: string },
): Promise<SettingsResult> {
	const parsed = profileSchema.safeParse(input);
	if (!parsed.success) return INVALIDO;
	const admin = await adminOf(slug);
	if ("ok" in admin) return admin;
	try {
		const current = await currentProfile(admin.supabase, admin.tenantId);
		if (!current) return GENERICO;
		return await writeProfile(
			slug,
			admin.supabase,
			admin.tenantId,
			parsed.data.displayName,
			// Sin logoUrl: mergeBrand conserva el logo que ya tenía.
			mergeBrand(current.brand, {
				primary: parsed.data.primary,
				secondary: parsed.data.secondary,
			}),
		);
	} catch (error) {
		console.error("saveProfile falló", error);
		return GENERICO;
	}
}

export async function saveLogo(
	slug: string,
	formData: FormData,
): Promise<SettingsResult> {
	const logo = formData.get("logo");
	if (!(logo instanceof File) || logo.size === 0) return INVALIDO;
	const checked = validateLogo(logo);
	if (!checked.ok) return checked;
	const admin = await adminOf(slug);
	if ("ok" in admin) return admin;
	try {
		const current = await currentProfile(admin.supabase, admin.tenantId);
		if (!current) return GENERICO;
		// Nombre nuevo en cada subida y sin upsert (el bucket no tiene policy de
		// select); de paso la URL cambia y no queda el logo viejo en caché.
		const path = `${slug}/logo-${Date.now()}.${checked.ext}`;
		const { error } = await admin.supabase.storage
			.from("brand")
			.upload(path, logo, { contentType: logo.type });
		if (error) return { ok: false, message: "No se pudo subir el logo." };
		return await writeProfile(
			slug,
			admin.supabase,
			admin.tenantId,
			current.displayName,
			mergeBrand(current.brand, {
				primary: String(current.brand.primary ?? ""),
				secondary: String(current.brand.secondary ?? ""),
				logoUrl: path,
			}),
		);
	} catch (error) {
		console.error("saveLogo falló", error);
		return GENERICO;
	}
}

export async function saveAuthMethods(
	slug: string,
	methods: string[],
): Promise<SettingsResult> {
	const parsed = z.array(z.string()).max(10).safeParse(methods);
	if (!parsed.success) return INVALIDO;
	const admin = await adminOf(slug);
	if ("ok" in admin) return admin;
	// Lo desconocido viaja igual: la base lo rechaza con su mensaje.
	const { error } = await admin.supabase.rpc("set_tenant_auth_methods", {
		p_tenant: admin.tenantId,
		p_methods: parsed.data,
	});
	if (error) return fromDbError(error);
	revalidatePath(`/${slug}/settings`);
	return { ok: true };
}

export async function saveAiMonthlyLimit(
	slug: string,
	limitUsd: number | null,
): Promise<SettingsResult> {
	const parsed = z.number().finite().min(0).nullable().safeParse(limitUsd);
	if (!parsed.success) return INVALIDO;
	const admin = await adminOf(slug);
	if ("ok" in admin) return admin;
	const { error } = await admin.supabase.rpc("set_ai_monthly_limit", {
		p_tenant: admin.tenantId,
		p_limit: parsed.data as never,
	});
	if (error) return fromDbError(error);
	revalidatePath(`/${slug}/settings`);
	return { ok: true };
}
