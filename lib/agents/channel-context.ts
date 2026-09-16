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

// El hook `session.started` (bind-session.ts) recién ata `eve_session_id` a
// la conversación DESPUÉS de que eve ya le devolvió el sessionId al cliente
// (POST /session responde en cuanto el workflow acepta el run, antes de que
// corran los hooks). El cliente abre el stream de esa sesión casi al toque
// de recibir la respuesta, así que esta lectura puede llegar antes de que el
// hook haya escrito. Reintentamos brevemente en vez de 401ear una carrera
// que se resuelve sola en milisegundos — no hay forma de evitarla desde el
// lado del cliente porque eve no expone un modo síncrono para esto.
const BIND_RETRY_DELAYS_MS = [100, 200, 400, 800, 1600];

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

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
/**
 * ¿Vale la pena seguir esperando a que aten el `eve_session_id`?
 *
 * La escalera de reintentos existe por una carrera de milisegundos: la fila ya
 * está, el hook todavía no escribió. Lo ÚNICO que prueba que esa escritura no
 * va a llegar nunca es que la conversación ya no exista, que es el caso que
 * este corte vino a resolver: desde que se puede borrar un hilo, su sesión
 * queda huérfana para siempre.
 *
 * Cualquier `eve_session_id` que ya esté puesto NO prueba nada: bindSession-
 * ToConversation es última-escritura-gana a propósito (session-store.ts), así
 * que una conversación con la sesión vieja de un turno fallido es exactamente
 * el estado previo a que el hook ate la nueva. Dos ciclos de review se
 * equivocaron mirando ese campo; acá no se mira más.
 *
 * Fail-open ante la duda: sin header no se puede saber, y un error de la
 * consulta (un header que no es uuid tira 22P02) tampoco es evidencia.
 */
async function bindStillPossible(
	admin: ReturnType<typeof createAdminClient>,
	request: Request,
): Promise<boolean> {
	const conversationId = request.headers.get("x-innovas-conversation");
	if (!conversationId) return true;

	const { data, error } = await admin
		.from("conversations")
		.select("id")
		.eq("id", conversationId)
		.maybeSingle();

	if (error) {
		console.error("bindStillPossible:", error.message);
		return true;
	}
	return data !== null;
}

export async function resolveChannelContext(
	request: Request,
	userId: string,
): Promise<ChannelContext | null> {
	const admin = createAdminClient();
	const sessionId = new URL(request.url).pathname.match(SESSION_PATH)?.[1];

	let conversation: ConversationRow | null = null;

	if (sessionId) {
		for (let attempt = 0; ; attempt++) {
			const { data } = await admin
				.from("conversations")
				.select("id, tenant_id, user_id, agent, tenants (slug)")
				.eq("eve_session_id", sessionId)
				.maybeSingle();
			conversation = data as ConversationRow | null;

			if (conversation || attempt >= BIND_RETRY_DELAYS_MS.length) break;
			// Reintentar solo si la escritura que esperamos todavía puede pasar.
			// Desde que se puede borrar un hilo, una sesión huérfana es un caso
			// común, y sin este corte cada request suyo dormía los 3,1s enteros
			// de la escalera y disparaba seis consultas antes de dar 401.
			if (!(await bindStillPossible(admin, request))) break;
			await sleep(BIND_RETRY_DELAYS_MS[attempt]);
		}
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
