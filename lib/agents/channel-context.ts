// Import relativo y no "@/": este módulo lo importa el canal de eve, que no
// resuelve los paths de tsconfig.
import { createAdminClient } from "../supabase/admin";

export interface ChannelContext {
	tenantId: string;
	tenantSlug: string;
	conversationId: string;
	role: string;
}

// Las rutas de sesión de eve traen el id en el path, tanto en
// /eve/v1/session/:id como en /eve/agents/<agente>/eve/v1/session/:id.
const SESSION_PATH = /\/eve\/v1\/session\/([^/?]+)/;

interface ConversationRow {
	id: string;
	tenant_id: string;
	user_id: string;
	agent: string;
	tenants: { slug: string } | null;
}

/**
 * Resuelve tenant y dueño para un request del canal de eve.
 *
 * Al crear una sesión el tenant sale de la conversación que la app creó antes
 * de `send()`. Al continuar, sale de la base buscando por `eve_session_id`, y
 * se ignora lo que manda el browser: eve no valida ownership de sesión
 * (guides/auth-and-route-protection.md), así que esta función es la puerta.
 *
 * Devuelve `null` ante cualquier duda; el canal traduce eso a 401.
 */
export async function resolveChannelContext(
	request: Request,
	userId: string,
): Promise<ChannelContext | null> {
	const admin = createAdminClient();
	const sessionId = new URL(request.url).pathname.match(SESSION_PATH)?.[1];

	let conversation: ConversationRow | null = null;

	if (sessionId) {
		const { data } = await admin
			.from("conversations")
			.select("id, tenant_id, user_id, agent, tenants (slug)")
			.eq("eve_session_id", sessionId)
			.maybeSingle();
		conversation = data as ConversationRow | null;
	} else {
		const conversationId = request.headers.get("x-innovas-conversation");
		if (!conversationId) return null;

		const { data } = await admin
			.from("conversations")
			.select("id, tenant_id, user_id, agent, tenants (slug)")
			.eq("id", conversationId)
			.maybeSingle();
		conversation = data as ConversationRow | null;
	}

	if (!conversation) return null;
	if (conversation.user_id !== userId) return null;

	const { data: membership } = await admin
		.from("memberships")
		.select("role")
		.eq("tenant_id", conversation.tenant_id)
		.eq("user_id", userId)
		.maybeSingle();

	if (!membership) return null;

	const { data: tenantAgent } = await admin
		.from("tenant_agents")
		.select("enabled")
		.eq("tenant_id", conversation.tenant_id)
		.eq("agent", conversation.agent)
		.maybeSingle();

	if (!tenantAgent?.enabled) return null;

	return {
		tenantId: conversation.tenant_id,
		tenantSlug: conversation.tenants?.slug ?? "",
		conversationId: conversation.id,
		role: membership.role as string,
	};
}
