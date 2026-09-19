import { notFound } from "next/navigation";
import { Card } from "@/components/ui/card";
import { toAccountRows } from "@/lib/outreach/cuentas-query";
import { createServerSupabase } from "@/lib/supabase/server";
import { resolveTenantAccess } from "@/lib/tenants/resolve";
import { CuentasClient } from "./cuentas-client";

export default async function CuentasPage({
	params,
}: {
	params: Promise<{ tenant: string }>;
}) {
	const { tenant: slug } = await params;
	const tenant = await resolveTenantAccess(slug);
	// 404 y no 403: un 403 le confirma a cualquiera que el cliente existe.
	if (!tenant) notFound();

	const supabase = await createServerSupabase();
	// Con el cliente del usuario: la RLS accounts_select decide qué filas se
	// ven. contacts(count) es un embed de conteo, no trae filas de contacts.
	const { data, error } = await supabase
		.from("accounts")
		.select(
			"id, domain, name, researched_at, expires_at, ficha, contacts(count)",
		)
		.eq("tenant_id", tenant.id)
		.order("researched_at", { ascending: false });

	if (error) {
		return (
			<Card className="p-6">
				<h1 className="font-semibold text-lg tracking-display">Cuentas</h1>
				<p className="mt-2 text-destructive text-sm">
					No se pudo leer las cuentas. Recargá la página; si sigue igual, algo
					anda mal con la base.
				</p>
			</Card>
		);
	}

	const rows = toAccountRows(data ?? [], new Date());

	return <CuentasClient rows={rows} />;
}
