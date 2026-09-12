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
	const { data: conversations } = await supabase
		.from("conversations")
		.select("id, title, model, eve_session_id, last_message_at")
		.eq("tenant_id", tenant.id)
		.eq("agent", "outreach")
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
