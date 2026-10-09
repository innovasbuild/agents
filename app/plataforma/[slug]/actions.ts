"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import {
	platformOwnerSlug,
	requirePlatformAdmin,
	type ServerSupabase,
} from "@/lib/tenants/platform";
import {
	mergeBrand,
	readTenantForm,
	tenantInputSchema,
	validateLogo,
} from "@/lib/tenants/tenant-form";

// guid y no uuid: el seed local usa ids que no son v4 y zod 4 exige la versión.
const idSchema = z.guid();

type Failure = { ok: false; message: string };
export type TenantResult = { ok: true } | Failure;

const SIN_PERMISO: Failure = { ok: false, message: "No tenés permiso." };
const INVALIDO: Failure = {
	ok: false,
	message: "No se pudo procesar el pedido.",
};
const NO_GUARDO: Failure = {
	ok: false,
	message: "No se pudieron guardar los cambios.",
};

const SIN_EL_METODO_PROPIO: Failure = {
	ok: false,
	message:
		"No podés sacarle al tenant dueño el método con el que entraste: te quedarías sin acceso a la consola.",
};

/**
 * Método con el que se abrió la sesión de quien edita, según la base (nunca
 * llega por parámetro). `null` ante cualquier duda: error, excepción o un
 * valor que no es un texto. Los tipos generados dicen `string`, pero la
 * función devuelve null cuando no reconoce el método.
 */
async function sessionLoginMethod(
	supabase: ServerSupabase,
): Promise<string | null> {
	try {
		const { data, error } = await supabase.rpc("current_login_method");
		if (error) {
			console.error("current_login_method falló:", error);
			return null;
		}
		const method: unknown = data;
		return typeof method === "string" && method !== "" ? method : null;
	} catch (error) {
		console.error("current_login_method falló:", error);
		return null;
	}
}

/**
 * Edita un tenant desde la consola de plataforma. El gate de la aplicación es
 * `requirePlatformAdmin`; la RLS `tenants_update` es la segunda puerta: un
 * update que filtra entero no da error, devuelve cero filas.
 */
export async function updateTenant(
	tenantId: string,
	formData: FormData,
): Promise<TenantResult> {
	// Fuera del try: puede tirar el redirect a la landing (método no permitido)
	// y un catch lo taparía con un error genérico.
	const admin = await requirePlatformAdmin();
	if (!admin) return SIN_PERMISO;

	try {
		if (!idSchema.safeParse(tenantId).success) return INVALIDO;

		const parsed = tenantInputSchema.safeParse(readTenantForm(formData));
		if (!parsed.success)
			return {
				ok: false,
				message: parsed.error.issues[0]?.message ?? INVALIDO.message,
			};
		const input = parsed.data;

		// Sin filtro por `active`: un tenant inactivo se edita igual, es la única
		// forma de reactivarlo.
		const { data: current } = await admin.supabase
			.from("tenants")
			.select("id, slug, brand")
			.eq("id", tenantId)
			.maybeSingle();
		if (!current) return SIN_PERMISO;

		// Desactivar al dueño deja la consola sin nadie que pueda entrar.
		if (!input.active && current.slug === platformOwnerSlug())
			return {
				ok: false,
				message: "El tenant dueño de la plataforma no se puede desactivar.",
			};

		// Lo mismo con los métodos: si el dueño se queda sin el método con el
		// que entró quien edita, desde el próximo request la consola rebota a
		// todos a una landing que no pueden usar. Solo se arregla por SQL.
		if (current.slug === platformOwnerSlug()) {
			const method = await sessionLoginMethod(admin.supabase);
			if (method === null || !(input.authMethods as string[]).includes(method))
				return SIN_EL_METODO_PROPIO;
		}

		let logoUrl: string | undefined;
		const logo = formData.get("logo");
		// Un input de archivo sin elegir manda un File vacío.
		if (logo instanceof File && logo.size > 0) {
			const checked = validateLogo(logo);
			if (!checked.ok) return checked;

			// Nombre nuevo en cada subida y sin upsert: pisar un objeto exige
			// policy de select en storage.objects, que el bucket no tiene. De paso
			// la URL cambia y no queda el logo viejo en caché.
			const path = `${current.slug}/logo-${Date.now()}.${checked.ext}`;
			const { error } = await admin.supabase.storage
				.from("brand")
				.upload(path, logo, { contentType: logo.type });
			if (error) return { ok: false, message: "No se pudo subir el logo." };
			logoUrl = path;
		}

		const { data, error } = await admin.supabase
			.from("tenants")
			.update({
				display_name: input.displayName,
				allowed_domains: input.allowedDomains,
				self_signup_by_domain: input.selfSignupByDomain,
				allowed_models: input.allowedModels,
				default_model: input.defaultModel,
				auth_methods: input.authMethods,
				active: input.active,
				brand: mergeBrand((current.brand ?? {}) as Record<string, unknown>, {
					primary: input.primary,
					secondary: input.secondary,
					logoUrl,
				}),
			})
			.eq("id", tenantId)
			.select("id")
			.maybeSingle();

		if (error) return NO_GUARDO;
		if (!data) return SIN_PERMISO;

		revalidatePath("/plataforma");
		revalidatePath(`/plataforma/${current.slug}`);
		revalidatePath(`/${current.slug}`, "layout");
		return { ok: true };
	} catch {
		return NO_GUARDO;
	}
}
