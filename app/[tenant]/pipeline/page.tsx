import { notFound } from "next/navigation";
import { Card } from "@/components/ui/card";
import { toFunnel } from "@/lib/outreach/pipeline-query";
import { createServerSupabase } from "@/lib/supabase/server";
import { resolveTenantAccess } from "@/lib/tenants/resolve";
import { PipelineClient } from "./pipeline-client";

export default async function PipelinePage({
	params,
}: {
	params: Promise<{ tenant: string }>;
}) {
	const { tenant: slug } = await params;
	const tenant = await resolveTenantAccess(slug);
	// 404 y no 403: un 403 le confirma a cualquiera que el cliente existe.
	if (!tenant) notFound();

	const supabase = await createServerSupabase();
	// Con el cliente del usuario, no service role: la RLS contacts_select ya
	// limita a los miembros del tenant, que es la visibilidad que queremos.
	const { data, error } = await supabase
		.from("contacts")
		.select("stage, last_touch_at")
		.eq("tenant_id", tenant.id);

	if (error) {
		return (
			<Card className="p-6">
				<h1 className="font-semibold text-lg tracking-display">Pipeline</h1>
				<p className="mt-2 text-destructive text-sm">
					No se pudo leer el pipeline. Recargá la página; si sigue igual, algo
					anda mal con la base.
				</p>
			</Card>
		);
	}

	const funnel = toFunnel(data ?? [], new Date());

	return <PipelineClient slug={slug} tenantId={tenant.id} funnel={funnel} />;
}
