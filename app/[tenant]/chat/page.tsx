import { notFound } from "next/navigation";
import { AGENT_CATALOG } from "@/lib/agents/catalog";
import {
	availableChatAgents,
	defaultChatAgent,
} from "@/lib/agents/chat-agents";
import { executorSignature } from "@/lib/outreach/signature-preview";
import { chatAiBlock } from "@/lib/plans/chat-allowance";
import { createServerSupabase } from "@/lib/supabase/server";
import {
	loadEnabledAgents,
	requireChatAgent,
} from "@/lib/tenants/enabled-agents";
import { resolveTenantAccess } from "@/lib/tenants/resolve";
import { ChatClient } from "./chat-client";

export default async function ChatPage({
	params,
	searchParams,
}: {
	params: Promise<{ tenant: string }>;
	searchParams: Promise<{ hilo?: string }>;
}) {
	const { tenant: slug } = await params;
	const { hilo } = await searchParams;
	const tenant = await resolveTenantAccess(slug);
	if (!tenant) notFound();
	await requireChatAgent(tenant.id);

	const supabase = await createServerSupabase();
	// Crédito de IA del plan: con el tope alcanzado el chat se muestra bloqueado
	// con el aviso, en vez de dejar que el turno falle (spec etapa 27 §5.5).
	const aiBlockPromise = chatAiBlock(tenant.id);

	// loadEnabledAgents está cacheada por request: es la misma lectura que ya
	// hizo requireChatAgent.
	const chatAgentIds = availableChatAgents(await loadEnabledAgents(tenant.id));
	const hasOutreach = chatAgentIds.includes("outreach");

	// La firma con la que sale el mail (send.ts la pega con composeMail): la
	// previsualización del chat la muestra para que el ejecutor apruebe el texto
	// completo, no un cuerpo al que después se le agrega algo. Solo la usan los
	// hilos de outreach. Va en paralelo con la lista de hilos: no se necesitan.
	const signatureQueries = hasOutreach
		? Promise.all([
				supabase
					.from("executors")
					.select("display_name, title, linkedin_url")
					.eq("tenant_id", tenant.id)
					.eq("user_id", tenant.userId)
					.maybeSingle(),
				supabase
					.from("tenant_agents")
					.select("config")
					.eq("tenant_id", tenant.id)
					.eq("agent", "outreach")
					.maybeSingle(),
			])
		: null;

	const [{ data: conversations }, signatureResults] = await Promise.all([
		supabase
			.from("conversations")
			.select("id, title, model, agent, eve_session_id, last_message_at")
			.eq("tenant_id", tenant.id)
			// Solo los hilos de agentes que hoy se pueden usar: el canal rechaza la
			// sesión de un agente deshabilitado, así que ni su historial se puede
			// leer (spec 22.1 C14). Vuelven si se lo habilita de nuevo.
			.in("agent", chatAgentIds)
			// user_id explícito: conversations_select (Task 4) también deja leer a un
			// tenant_admin/platform_admin TODAS las conversaciones del tenant, para la
			// pantalla de oversight que todavía no existe. Esta es la pantalla "mis
			// hilos" (spec §7: "propios"); sin el filtro, un admin vería una lista
			// mezclada con títulos de otros usuarios y, al clickear uno ajeno,
			// resolveChannelContext (Task 10) rechazaría el 401 sin que la UI explique
			// nada.
			.eq("user_id", tenant.userId)
			.order("last_message_at", { ascending: false })
			.limit(50),
		signatureQueries,
	]);
	const signature = signatureResults
		? executorSignature(
				signatureResults[0].data ?? null,
				signatureResults[1].data?.config ?? null,
			)
		: null;

	const threads = conversations ?? [];
	const active = threads.find((thread) => thread.id === hilo) ?? null;
	const defaultAgent = defaultChatAgent(chatAgentIds, threads);
	// requireChatAgent ya dio 404 si no hay ninguno; esto cubre la carrera de
	// un agente deshabilitado entre las dos lecturas.
	if (!defaultAgent) notFound();

	return (
		<ChatClient
			active={active}
			aiBlock={await aiBlockPromise}
			agents={chatAgentIds.map((id) => ({
				id,
				name: AGENT_CATALOG[id].name,
			}))}
			allowedModels={tenant.allowedModels}
			defaultAgent={defaultAgent}
			defaultModel={tenant.defaultModel}
			signature={signature}
			slug={slug}
			tenantId={tenant.id}
			threads={threads}
		/>
	);
}
