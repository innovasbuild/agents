import { notFound } from "next/navigation";
import { Card } from "@/components/ui/card";
import type { ContactIcp } from "@/lib/outreach/store";
import { createServerSupabase } from "@/lib/supabase/server";
import { resolveTenantAccess } from "@/lib/tenants/resolve";
import { RevisarClient } from "./revisar-client";

export interface RevisarContactRow {
	id: string;
	name: string | null;
	company: string | null;
	title: string | null;
	icp: ContactIcp | null;
}

function ErrorCard() {
	return (
		<Card className="p-6">
			<h1 className="font-semibold text-lg tracking-display">Revisar</h1>
			<p className="mt-2 text-destructive text-sm">
				No se pudo leer los contactos para revisar. Recargá la página; si
				sigue igual, algo anda mal con la base.
			</p>
		</Card>
	);
}

export default async function RevisarPage({
	params,
}: {
	params: Promise<{ tenant: string; id: string }>;
}) {
	const { tenant: slug, id: focusId } = await params;
	const tenant = await resolveTenantAccess(slug);
	// 404 y no 403: mismo criterio que /focos (un 403 le confirma a cualquiera
	// que el foco existe).
	if (!tenant) notFound();

	const supabase = await createServerSupabase();

	// El name alcanza para el título de esta pantalla chica: no hace falta
	// pasar por listFocuses/funnelForFocus (Task 22), un select directo (RLS
	// decide) resuelve tanto el título como el chequeo de "existe y es de este
	// tenant".
	const focusResult = await supabase
		.from("search_focuses")
		.select("id, name")
		.eq("tenant_id", tenant.id)
		.eq("id", focusId)
		.maybeSingle();

	if (focusResult.error) return <ErrorCard />;
	if (!focusResult.data) notFound();

	const contactsResult = await supabase
		.from("contacts")
		.select("id, name, company, title, icp")
		.eq("tenant_id", tenant.id)
		.eq("search_focus_id", focusId)
		.eq("icp->>lane", "para_revisar");

	if (contactsResult.error) return <ErrorCard />;

	return (
		<RevisarClient
			contacts={(contactsResult.data ?? []) as RevisarContactRow[]}
			focusName={focusResult.data.name as string}
			slug={slug}
		/>
	);
}
