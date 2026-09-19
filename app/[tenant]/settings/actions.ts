"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createServerSupabase } from "@/lib/supabase/server";

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
