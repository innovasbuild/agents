import { notFound } from "next/navigation";
import { Card } from "@/components/ui/card";
import { toMetricas } from "@/lib/outreach/metricas-query";
import { createServerSupabase } from "@/lib/supabase/server";
import { resolveTenantAccess } from "@/lib/tenants/resolve";
import { MetricasClient } from "./metricas-client";

export default async function MetricasPage({
	params,
}: {
	params: Promise<{ tenant: string }>;
}) {
	const { tenant: slug } = await params;
	const tenant = await resolveTenantAccess(slug);
	// 404 y no 403: un 403 le confirma a cualquiera que el cliente existe.
	if (!tenant) notFound();

	const supabase = await createServerSupabase();
	// Tres lecturas con el cliente del usuario. PostgREST no cruza contacts
	// con events en una sola consulta (columnas de tablas distintas, sin FK
	// entre ellas): el cruce por contact_key lo hace toMetricas en JS.
	const [contactsResult, eventsResult, configResult] = await Promise.all([
		supabase
			.from("contacts")
			.select(
				"contact_key, hook, vector, segment, touches, stage, owner_user_id, executors(slug)",
			)
			.eq("tenant_id", tenant.id),
		supabase
			.from("events")
			.select("contact_key")
			.eq("tenant_id", tenant.id)
			.eq("type", "rebote"),
		supabase
			.from("config_values")
			.select("kind, value, label")
			.eq("tenant_id", tenant.id),
	]);

	if (contactsResult.error || eventsResult.error || configResult.error) {
		return (
			<Card className="p-6">
				<h1 className="font-semibold text-lg tracking-display">Métricas</h1>
				<p className="mt-2 text-destructive text-sm">
					No se pudo leer las métricas. Recargá la página; si sigue igual, algo
					anda mal con la base.
				</p>
			</Card>
		);
	}

	const metricas = toMetricas(
		contactsResult.data ?? [],
		eventsResult.data ?? [],
		configResult.data ?? [],
	);

	return <MetricasClient metricas={metricas} />;
}
