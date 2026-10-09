"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createServerSupabase } from "@/lib/supabase/server";
import { isPublicEmailDomain } from "@/lib/tenants/public-email-domains";

// Una server action la puede invocar cualquier cliente autenticado con los
// argumentos que quiera: se validan en el borde, igual que en las otras
// actions del dashboard.
const idSchema = z.uuid();
const slugSchema = z.string().regex(/^[a-z0-9-]{1,63}$/);
const modelSchema = z.string().min(1).max(200);

export type SettingsResult = { ok: true } | { ok: false; message: string };

const INVALIDO: SettingsResult = {
	ok: false,
	message: "No se pudo procesar el pedido.",
};

/**
 * Cambia el modelo default del tenant. La RLS `tenants_update` ya exige
 * `tenant_admin` o `platform_admin`; acá no se repite ese chequeo, se lee su
 * resultado: sin fila devuelta, no hubo permiso.
 */
export async function updateDefaultModel(
	tenantId: string,
	model: string,
	slug: string,
): Promise<SettingsResult> {
	if (!idSchema.safeParse(tenantId).success) return INVALIDO;
	if (!modelSchema.safeParse(model).success) return INVALIDO;
	if (!slugSchema.safeParse(slug).success) return INVALIDO;

	const supabase = await createServerSupabase();
	const { data, error } = await supabase
		.from("tenants")
		.update({ default_model: model })
		.eq("id", tenantId)
		.select("id")
		.maybeSingle();

	// El check `tenants_default_model_allowed` (default_model ∈ allowed_models)
	// tira acá si alguien manda un modelo fuera de la lista permitida.
	if (error)
		return {
			ok: false,
			message: "Ese modelo no está permitido para este cliente.",
		};
	// Un update que la RLS filtró entero no devuelve error, devuelve cero filas:
	// el select().maybeSingle() es lo único que lo distingue de un éxito.
	if (!data)
		return { ok: false, message: "No tenés permiso para cambiar el modelo." };

	revalidatePath(`/${slug}/settings`);
	return { ok: true };
}

/**
 * Abre o cierra el ingreso por dominio. Los dominios los carga plataforma;
 * acá solo se elige el modo. Abrirlo exige dominios propios (nada vacío ni de
 * correo público: el candado de la base ya impide lo primero, esto da el
 * mensaje). La RLS y el trigger tenants_guard_columns dejan escribir a un
 * tenant_admin solo default_model y self_signup_by_domain.
 */
export async function updateSignupMode(
	tenantId: string,
	open: boolean,
	slug: string,
): Promise<SettingsResult> {
	if (!idSchema.safeParse(tenantId).success) return INVALIDO;
	if (typeof open !== "boolean") return INVALIDO;
	if (!slugSchema.safeParse(slug).success) return INVALIDO;

	const sinPermiso: SettingsResult = {
		ok: false,
		message: "No tenés permiso para cambiar el ingreso.",
	};
	const supabase = await createServerSupabase();

	if (open) {
		const { data: current } = await supabase
			.from("tenants")
			.select("allowed_domains")
			.eq("id", tenantId)
			.maybeSingle();
		if (!current) return sinPermiso;

		const domains = current.allowed_domains as string[];
		if (domains.length === 0)
			return {
				ok: false,
				message:
					"Este cliente no tiene dominios cargados. Escribinos a hola@innov.as para que los carguemos.",
			};
		const publico = domains.find(isPublicEmailDomain);
		if (publico)
			return {
				ok: false,
				message: `"${publico}" es un correo público: no puede abrir el ingreso. Escribinos a hola@innov.as.`,
			};
	}

	const { data, error } = await supabase
		.from("tenants")
		.update({ self_signup_by_domain: open })
		.eq("id", tenantId)
		.select("id")
		.maybeSingle();

	if (error) return { ok: false, message: "No se pudo guardar el ingreso." };
	if (!data) return sinPermiso;

	revalidatePath(`/${slug}/settings`);
	return { ok: true };
}
