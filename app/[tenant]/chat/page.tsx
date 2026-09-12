import { notFound } from "next/navigation";
import { createServerSupabase } from "@/lib/supabase/server";
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

	const supabase = await createServerSupabase();
	const { data: auth } = await supabase.auth.getUser();
	if (!auth.user) notFound();

	const { data: conversations } = await supabase
		.from("conversations")
		.select("id, title, model, eve_session_id, last_message_at")
		.eq("tenant_id", tenant.id)
		.eq("agent", "outreach")
		// user_id explícito: conversations_select (Task 4) también deja leer a un
		// tenant_admin/platform_admin TODAS las conversaciones del tenant, para la
		// pantalla de oversight que todavía no existe. Esta es la pantalla "mis
		// hilos" (spec §7: "propios"); sin el filtro, un admin vería una lista
		// mezclada con títulos de otros usuarios y, al clickear uno ajeno,
		// resolveChannelContext (Task 10) rechazaría el 401 sin que la UI explique
		// nada.
		.eq("user_id", auth.user.id)
		.order("last_message_at", { ascending: false })
		.limit(50);

	const threads = conversations ?? [];
	const active = threads.find((thread) => thread.id === hilo) ?? null;

	return (
		<ChatClient
			active={active}
			allowedModels={tenant.allowedModels}
			defaultModel={tenant.defaultModel}
			slug={slug}
			tenantId={tenant.id}
			threads={threads}
		/>
	);
}
