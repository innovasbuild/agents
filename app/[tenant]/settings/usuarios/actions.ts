"use server";

import { revalidatePath } from "next/cache";
import { createServerSupabase } from "@/lib/supabase/server";
import { actionAllowsLogin } from "@/lib/tenants/login-check-server";

type Supabase = Awaited<ReturnType<typeof createServerSupabase>>;

/**
 * Estas actions reciben el id de una fila, no el de la empresa: se lee de la
 * fila con el cliente de la sesión (la RLS aplica) y contra esa empresa se
 * chequea el método con el que se abrió la sesión (spec etapa 20, L10 a L12).
 * Falso sin sesión, si la fila no se ve o no se pudo leer, o si la empresa no
 * permite el método: en todos esos casos no se escribe nada.
 */
async function sessionAllowedOnRow(
	supabase: Supabase,
	table: "memberships" | "invitations",
	rowId: string,
): Promise<boolean> {
	const { data: auth } = await supabase.auth.getUser();
	if (!auth.user) return false;

	const { data: row, error } = await supabase
		.from(table)
		.select("tenant_id")
		.eq("id", rowId)
		.maybeSingle();
	if (error || !row) return false;

	return actionAllowsLogin(supabase, auth.user.id, row.tenant_id);
}

export async function revokeMembership(membershipId: string, slug: string) {
	const supabase = await createServerSupabase();
	if (await sessionAllowedOnRow(supabase, "memberships", membershipId)) {
		// La RLS decide: si no sos admin del tenant, no borra nada.
		await supabase.from("memberships").delete().eq("id", membershipId);
	}
	revalidatePath(`/${slug}/settings/usuarios`);
}

export async function revokeInvitation(invitationId: string, slug: string) {
	const supabase = await createServerSupabase();
	if (await sessionAllowedOnRow(supabase, "invitations", invitationId)) {
		await supabase
			.from("invitations")
			.update({ status: "revoked" })
			.eq("id", invitationId);
	}
	revalidatePath(`/${slug}/settings/usuarios`);
}
