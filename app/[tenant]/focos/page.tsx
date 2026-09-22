import { notFound } from "next/navigation";
import { Card } from "@/components/ui/card";
import { groupConfigValuesByKind } from "@/lib/outreach/focus-query";
import { webStoreDeps } from "@/lib/outreach/web-context";
import { createServerSupabase } from "@/lib/supabase/server";
import { resolveTenantAccess } from "@/lib/tenants/resolve";
import { FocosClient } from "./focos-client";

function ErrorCard() {
	return (
		<Card className="p-6">
			<h1 className="font-semibold text-lg tracking-display">Focos</h1>
			<p className="mt-2 text-destructive text-sm">
				No se pudo leer los focos. Recargá la página; si sigue igual, algo anda
				mal con la base.
			</p>
		</Card>
	);
}

export default async function FocosPage({
	params,
}: {
	params: Promise<{ tenant: string }>;
}) {
	const { tenant: slug } = await params;
	const tenant = await resolveTenantAccess(slug);
	// 404 y no 403: un 403 le confirma a cualquiera que el cliente existe.
	if (!tenant) notFound();

	const supabase = await createServerSupabase();
	// Las listas cerradas (vector, segmento, hook, idioma) salen de config_values
	// con la misma consulta directa que usa app/[tenant]/metricas/page.tsx, no
	// de /settings (esa pantalla no las carga para este propósito). Solo las
	// activas: no tiene sentido ofrecer para un foco nuevo un valor que el
	// tenant ya dio de baja.
	const configResult = await supabase
		.from("config_values")
		.select("kind, value, label")
		.eq("tenant_id", tenant.id)
		.eq("active", true);

	if (configResult.error) return <ErrorCard />;

	// listFocuses/funnelForFocus (Task 22) viven en el store, no en una
	// consulta directa: funnelForFocus cruza contacts con queue_items, algo
	// que PostgREST no hace en una sola llamada. store.* usa el cliente admin
	// (igual que las acciones de esta misma pantalla en actions.ts) y filtra
	// por tenant_id a mano; ambos métodos lanzan en vez de devolver {error},
	// así que el try/catch es lo que arma la misma tarjeta de error que el
	// resto de las pantallas.
	const { store } = webStoreDeps();
	try {
		const focuses = await store.listFocuses(tenant.id);
		const funnels = await Promise.all(
			focuses.map((focus) => store.funnelForFocus(tenant.id, focus.id)),
		);
		const options = groupConfigValuesByKind(configResult.data ?? []);

		return (
			<FocosClient
				slug={slug}
				focuses={focuses}
				funnels={funnels}
				options={options}
			/>
		);
	} catch {
		return <ErrorCard />;
	}
}
