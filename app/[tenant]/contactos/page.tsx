import { notFound } from "next/navigation";
import { Card } from "@/components/ui/card";
import {
	ilikePattern,
	parseContactFilters,
	toContactRows,
} from "@/lib/outreach/contactos-query";
import { createServerSupabase } from "@/lib/supabase/server";
import { resolveTenantAccess } from "@/lib/tenants/resolve";
import { ContactosClient } from "./contactos-client";

/** Tope de filas por pantalla. Paginar entra cuando haga falta de verdad. */
const PAGE_SIZE = 200;

export default async function ContactosPage({
	params,
	searchParams,
}: {
	params: Promise<{ tenant: string }>;
	searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
	const { tenant: slug } = await params;
	const tenant = await resolveTenantAccess(slug);
	// 404 y no 403: un 403 le confirma a cualquiera que el cliente existe.
	if (!tenant) notFound();

	const raw = await searchParams;
	const search = new URLSearchParams();
	for (const [key, value] of Object.entries(raw)) {
		if (typeof value === "string") search.set(key, value);
	}
	const filters = parseContactFilters(search);

	const supabase = await createServerSupabase();
	// `executors!inner` solo cuando se filtra por ejecutor: un embed normal
	// filtra el embed y deja la fila padre, así que sin el inner el filtro no
	// sacaría a nadie de la lista. Con el inner siempre, en cambio,
	// desaparecerían los contactos que todavía no tienen dueño.
	const columns = `id, contact_key, name, company, email, stage, touches, last_touch_at, next_step_at, vector, hook, owner_user_id, icp, ${
		filters.ejecutor ? "executors!inner(slug)" : "executors(slug)"
	}, accounts(domain)`;

	// Con el cliente del usuario: la RLS contacts_select decide qué filas se ven.
	let query = supabase
		.from("contacts")
		.select(columns)
		.eq("tenant_id", tenant.id);

	if (filters.ejecutor) query = query.eq("executors.slug", filters.ejecutor);
	if (filters.etapa) query = query.eq("stage", filters.etapa);
	if (filters.vector) query = query.eq("vector", filters.vector);
	if (filters.hook) query = query.eq("hook", filters.hook);
	if (filters.lane) query = query.eq("icp->>lane", filters.lane);
	if (filters.q) {
		// ilikePattern saca los caracteres con los que se podría reescribir el
		// or(): sin eso, una coma en la búsqueda cambia la consulta entera.
		const pattern = ilikePattern(filters.q);
		if (pattern) {
			query = query.or(
				`name.ilike.${pattern},company.ilike.${pattern},email.ilike.${pattern}`,
			);
		}
	}

	const { data, error } = await query
		.order("last_touch_at", { ascending: false, nullsFirst: false })
		.limit(PAGE_SIZE);

	if (error) {
		return (
			<Card className="p-6">
				<h1 className="font-semibold text-lg tracking-display">Contactos</h1>
				<p className="mt-2 text-destructive text-sm">
					No se pudo leer los contactos. Recargá la página; si sigue igual, algo
					anda mal con la base.
				</p>
			</Card>
		);
	}

	const rows = toContactRows(data ?? []);

	return (
		<ContactosClient
			slug={slug}
			filters={filters}
			rows={rows}
			truncated={rows.length === PAGE_SIZE}
		/>
	);
}
