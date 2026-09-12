"use server";

import { revalidatePath } from "next/cache";
import { createServerSupabase } from "@/lib/supabase/server";

export async function revokeMembership(membershipId: string, slug: string) {
	const supabase = await createServerSupabase();
	// La RLS decide: si no sos admin del tenant, no borra nada.
	await supabase.from("memberships").delete().eq("id", membershipId);
	revalidatePath(`/${slug}/settings/usuarios`);
}

export async function revokeInvitation(invitationId: string, slug: string) {
	const supabase = await createServerSupabase();
	await supabase
		.from("invitations")
		.update({ status: "revoked" })
		.eq("id", invitationId);
	revalidatePath(`/${slug}/settings/usuarios`);
}
