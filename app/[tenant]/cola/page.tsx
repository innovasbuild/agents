import { notFound } from "next/navigation";
import { toColaRows } from "@/lib/outreach/cola-query";
import { createServerSupabase } from "@/lib/supabase/server";
import { resolveTenantAccess } from "@/lib/tenants/resolve";
import { ColaClient } from "./cola-client";

export default async function ColaPage({
	params,
}: {
	params: Promise<{ tenant: string }>;
}) {
	const { tenant: slug } = await params;
	const tenant = await resolveTenantAccess(slug);
	// 404 y no 403: un 403 le confirma a cualquiera que el cliente existe.
	if (!tenant) notFound();

	const supabase = await createServerSupabase();
	const { data: auth } = await supabase.auth.getUser();

	// Se lee con el cliente del usuario, no con service role: la RLS
	// queue_items_select ya limita a los miembros del tenant, que es
	// exactamente la visibilidad que queremos (ver el spec, D2).
	const { data } = await supabase
		.from("queue_items")
		.select(
			"id, subject, body, to_email, kind, status, hook, vector, expires_at, error, executor_user_id, executors(slug), contacts(name, company, stage)",
		)
		.eq("tenant_id", tenant.id)
		.in("status", ["pending", "approved"])
		.order("created_at", { ascending: true });

	return (
		<ColaClient
			slug={slug}
			tenantId={tenant.id}
			currentUserId={auth.user?.id ?? ""}
			rows={toColaRows(data ?? [])}
		/>
	);
}
