"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { inviteToTenant } from "@/lib/invitations/invite";
import { createAdminClient } from "@/lib/supabase/admin";
import { requirePlatformAdmin } from "@/lib/tenants/platform";
import {
	createTenantSchema,
	readCreateForm,
} from "@/lib/tenants/tenant-create";
import { mergeBrand, validateLogo } from "@/lib/tenants/tenant-form";

type Failure = { ok: false; message: string };
export type CreateResult =
	| { ok: true; slug: string; warnings: string[] }
	| Failure;

const SIN_PERMISO: Failure = { ok: false, message: "No tenés permiso." };
const NO_CREO: Failure = { ok: false, message: "No se pudo crear la empresa." };

const LOGO_WARNING = "No se pudo subir el logo. Subilo desde esta pantalla.";
const INVITE_WARNING =
	"No se pudo mandar la invitación al administrador. Invitalo desde Usuarios.";

/**
 * Alta de una empresa (spec alta §5). Tenant + agente son atómicos (SQL);
 * logo e invitación no: si fallan, la empresa queda creada y se informa.
 */
export async function createTenant(formData: FormData): Promise<CreateResult> {
	try {
		const admin = await requirePlatformAdmin();
		if (!admin) return SIN_PERMISO;

		const parsed = createTenantSchema.safeParse(readCreateForm(formData));
		if (!parsed.success)
			return {
				ok: false,
				message: parsed.error.issues[0]?.message ?? NO_CREO.message,
			};
		const input = parsed.data;

		// El logo se valida ANTES de crear: un archivo inválido no deja una
		// empresa a medias.
		const logo = formData.get("logo");
		const hasLogo = logo instanceof File && logo.size > 0;
		const checkedLogo = hasLogo ? validateLogo(logo) : null;
		if (checkedLogo && !checkedLogo.ok) return checkedLogo;

		const colors = { primary: input.primary, secondary: input.secondary };
		const brand = mergeBrand({}, colors);

		const { data: tenantId, error } = await admin.supabase.rpc(
			"create_tenant",
			{
				p_slug: input.slug,
				p_display_name: input.displayName,
				p_allowed_domains: input.allowedDomains,
				p_auth_methods: input.authMethods,
				p_brand: brand,
			},
		);
		if (error || !tenantId) {
			if (error?.code === "23505")
				return { ok: false, message: "Ya hay una empresa con ese slug." };
			if (error?.code === "23514")
				return {
					ok: false,
					message: "Ese slug está reservado o tiene un formato inválido.",
				};
			if (error?.code === "42501") return SIN_PERMISO;
			return NO_CREO;
		}

		const warnings: string[] = [];

		if (hasLogo && checkedLogo?.ok) {
			const path = `${input.slug}/logo-${Date.now()}.${checkedLogo.ext}`;
			const { error: uploadError } = await admin.supabase.storage
				.from("brand")
				.upload(path, logo, { contentType: logo.type });
			if (uploadError) warnings.push(LOGO_WARNING);
			else
				await admin.supabase
					.from("tenants")
					.update({ brand: mergeBrand(brand, { ...colors, logoUrl: path }) })
					.eq("id", tenantId);
		}

		const origin =
			(await headers()).get("origin") ?? process.env.PUBLIC_APP_URL ?? "";
		const outcome = await inviteToTenant({
			admin: createAdminClient(),
			tenantId,
			email: input.adminEmail,
			role: "tenant_admin",
			invitedBy: admin.userId,
			allowExternal: input.allowExternalAdmin,
			origin,
			next: `/${input.slug}/chat`,
		});
		if (outcome.kind !== "ok" && outcome.kind !== "ya_existe")
			warnings.push(INVITE_WARNING);

		revalidatePath("/plataforma");
		return { ok: true, slug: input.slug, warnings };
	} catch {
		return NO_CREO;
	}
}
