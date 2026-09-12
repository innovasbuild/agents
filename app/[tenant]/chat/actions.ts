"use server";

import { revalidatePath } from "next/cache";
import { createServerSupabase } from "@/lib/supabase/server";

export async function createConversation(
	tenantId: string,
	slug: string,
	model: string,
): Promise<string | null> {
	const supabase = await createServerSupabase();
	const { data: auth } = await supabase.auth.getUser();
	if (!auth.user) return null;

	// La fila se crea ANTES de send(): el canal valida contra ella y el hook
	// bind-session le escribe después el eve_session_id.
	const { data, error } = await supabase
		.from("conversations")
		.insert({
			tenant_id: tenantId,
			user_id: auth.user.id,
			agent: "outreach",
			model,
		})
		.select("id")
		.single();

	if (error) return null;

	revalidatePath(`/${slug}/chat`);
	return data.id;
}

export async function renameConversation(
	conversationId: string,
	title: string,
	slug: string,
) {
	const supabase = await createServerSupabase();
	await supabase
		.from("conversations")
		.update({
			title: title.slice(0, 80),
			last_message_at: new Date().toISOString(),
		})
		.eq("id", conversationId);
	revalidatePath(`/${slug}/chat`);
}
