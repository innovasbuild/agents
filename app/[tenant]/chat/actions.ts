"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { AGENT_CATALOG, isCatalogAgent } from "@/lib/agents/catalog";
import { chatAiBlock } from "@/lib/plans/chat-allowance";
import type { LimitReason } from "@/lib/plans/limits";
import { createServerSupabase } from "@/lib/supabase/server";
import { loadEnabledAgents } from "@/lib/tenants/enabled-agents";
import { actionAllowsLogin } from "@/lib/tenants/login-check-server";
import { resolveTenantAccess } from "@/lib/tenants/resolve";

// Una server action la puede invocar cualquier cliente autenticado con los
// argumentos que quiera: se validan en el borde, igual que el inputSchema de
// las tools (agents/outreach/tools/*.ts).
const conversationIdSchema = z.uuid();
const slugSchema = z.string().regex(/^[a-z0-9-]{1,63}$/);

type Supabase = Awaited<ReturnType<typeof createServerSupabase>>;

/**
 * Empresa de un hilo, leída con el cliente de la sesión (la RLS aplica).
 * `null` si el hilo no se ve; `error` si no se pudo leer.
 */
async function conversationTenant(
	supabase: Supabase,
	conversationId: string,
): Promise<{ tenantId: string | null; error: boolean }> {
	const { data, error } = await supabase
		.from("conversations")
		.select("tenant_id")
		.eq("id", conversationId)
		.maybeSingle();
	if (error) return { tenantId: null, error: true };
	return { tenantId: data?.tenant_id ?? null, error: false };
}

export async function createConversation(
	tenantId: string,
	slug: string,
	model: string,
	agent: string,
): Promise<string | { blocked: LimitReason } | null> {
	const supabase = await createServerSupabase();
	const { data: auth } = await supabase.auth.getUser();
	if (!auth.user) return null;

	// Las páginas ya chequean el método de la sesión; una action se puede
	// invocar directo, así que lo chequea ella (spec etapa 20, L10 a L12).
	if (!(await actionAllowsLogin(supabase, auth.user.id, tenantId))) return null;

	// El selector solo ofrece agentes de chat habilitados, pero el argumento
	// llega de afuera (spec 22.1 §6.4). Si la lista no se pudo leer se deja
	// pasar: el canal valida tenant_agents.enabled antes de abrir la sesión.
	if (!isCatalogAgent(agent) || !AGENT_CATALOG[agent].chat) return null;
	const enabled = await loadEnabledAgents(tenantId);
	if (enabled && !enabled.includes(agent)) return null;

	// Sin crédito de IA no se abre el hilo: el cliente muestra el diálogo del
	// plan con este motivo (spec etapa 27 §5.5).
	const blocked = await chatAiBlock(tenantId);
	if (blocked) return { blocked };

	// La fila se crea ANTES de send(): el canal valida contra ella y el hook
	// bind-session le escribe después el eve_session_id.
	const { data, error } = await supabase
		.from("conversations")
		.insert({
			tenant_id: tenantId,
			user_id: auth.user.id,
			agent,
			model,
		})
		.select("id")
		.single();

	if (error) return null;

	revalidatePath(`/${slug}/chat`);
	return data.id;
}

/**
 * El motivo del corte de crédito de IA de la empresa, o null. Respaldo del
 * cliente cuando un turn.failed no trae `ai_allowance:` (R13 F4). Cualquier
 * miembro puede preguntar por su empresa; quien no lo es recibe null.
 */
export async function checkChatBlock(
	slug: string,
): Promise<LimitReason | null> {
	if (!slugSchema.safeParse(slug).success) return null;
	try {
		const access = await resolveTenantAccess(slug);
		if (!access) return null;
		return await chatAiBlock(access.id);
	} catch (error) {
		console.error("checkChatBlock:", error);
		return null;
	}
}

export async function renameConversation(
	conversationId: string,
	title: string,
	slug: string,
) {
	const supabase = await createServerSupabase();
	const { data: auth } = await supabase.auth.getUser();
	// Sin sesión, sin hilo a la vista o con un método que la empresa del hilo
	// no permite, no se escribe; se revalida igual, como siempre.
	const tenantId = auth.user
		? (await conversationTenant(supabase, conversationId)).tenantId
		: null;
	if (
		auth.user &&
		tenantId &&
		(await actionAllowsLogin(supabase, auth.user.id, tenantId))
	) {
		await supabase
			.from("conversations")
			.update({
				title: title.slice(0, 80),
				last_message_at: new Date().toISOString(),
			})
			.eq("id", conversationId);
	}
	revalidatePath(`/${slug}/chat`);
}

/**
 * Borra un hilo propio. La sesión de eve que quedó atada no se borra: el
 * `eve_session_id` queda huérfano y nadie puede reclamarlo, porque
 * authenticated no tiene grant sobre esa columna (migración
 * lock_conversation_columns). Los `runs` YA ABIERTOS del hilo sobreviven con
 * `conversation_id` en null (on delete set null), así que el costo y la
 * auditoría de lo que ya corrió no se pierden.
 */
export async function deleteConversation(
	conversationId: string,
	slug: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
	if (
		!conversationIdSchema.safeParse(conversationId).success ||
		!slugSchema.safeParse(slug).success
	) {
		return { ok: false, error: "No se pudo borrar el hilo." };
	}

	const supabase = await createServerSupabase();
	const { data: auth } = await supabase.auth.getUser();
	if (!auth.user) return { ok: false, error: "Volvé a entrar: no hay sesión." };

	// El método de la sesión se chequea contra la empresa del hilo. Un hilo
	// que no se ve contesta lo mismo que un borrado que no tocó filas.
	const conversation = await conversationTenant(supabase, conversationId);
	if (conversation.error)
		return { ok: false, error: "No se pudo borrar el hilo." };
	if (!conversation.tenantId)
		return { ok: false, error: "Ese hilo ya no está." };
	if (!(await actionAllowsLogin(supabase, auth.user.id, conversation.tenantId)))
		return { ok: false, error: "No se pudo borrar el hilo." };

	// El `select` no es cosmético: un DELETE que RLS filtra entero no devuelve
	// error, devuelve cero filas. Sin esto, borrar el hilo de otro contestaba
	// ok:true y la pantalla festejaba un borrado que nunca pasó.
	// conversations_delete también deja borrar a un tenant_admin las de su
	// gente; el user_id acota a los propios, que es lo que muestra esta
	// pantalla.
	const { data, error } = await supabase
		.from("conversations")
		.delete()
		.eq("id", conversationId)
		.eq("user_id", auth.user.id)
		.select("id");

	if (error) {
		console.error("deleteConversation:", error.message);
		return { ok: false, error: "No se pudo borrar el hilo." };
	}
	if (!data || data.length === 0) {
		return { ok: false, error: "Ese hilo ya no está." };
	}

	revalidatePath(`/${slug}/chat`);
	return { ok: true };
}
