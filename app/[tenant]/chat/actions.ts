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

/**
 * Borra un hilo propio. La sesión de eve que quedó atada no se borra: el
 * `eve_session_id` queda huérfano y nadie puede reclamarlo, porque
 * authenticated no tiene grant sobre esa columna (migración
 * lock_conversation_columns). Los `runs` del hilo sobreviven con
 * `conversation_id` en null (on delete set null): el costo y la auditoría no
 * se pierden.
 */
export async function deleteConversation(
	conversationId: string,
	slug: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
	const supabase = await createServerSupabase();
	const { data: auth } = await supabase.auth.getUser();
	if (!auth.user) return { ok: false, error: "Volvé a entrar: no hay sesión." };

	// conversations_delete también deja borrar a un tenant_admin las de su
	// gente; el user_id acota a los propios, que es lo que muestra esta
	// pantalla.
	const { error } = await supabase
		.from("conversations")
		.delete()
		.eq("id", conversationId)
		.eq("user_id", auth.user.id);

	if (error) return { ok: false, error: "No se pudo borrar el hilo." };

	revalidatePath(`/${slug}/chat`);
	return { ok: true };
}
