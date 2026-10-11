import { notFound, redirect } from "next/navigation";
import {
	loadBrainEnabled,
	loadEnabledAgents,
} from "@/lib/tenants/enabled-agents";
import { tenantHome } from "@/lib/tenants/home";
import { resolveTenantAccess } from "@/lib/tenants/resolve";

// La empresa no tiene portada propia: se entra a lo que tenga habilitado
// (spec 21.4 §3.2).
export default async function TenantHomePage({
	params,
}: {
	params: Promise<{ tenant: string }>;
}) {
	const { tenant: slug } = await params;
	const tenant = await resolveTenantAccess(slug);
	// 404 y no 403: un 403 le confirma a cualquiera que el cliente existe.
	if (!tenant) notFound();

	const [enabledAgents, brain] = await Promise.all([
		loadEnabledAgents(tenant.id),
		loadBrainEnabled(tenant.id),
	]);
	// Si no se pudieron leer los agentes, no se degrada a nadie: queda el
	// aterrizaje de siempre, el chat.
	if (enabledAgents === null) redirect(`/${slug}/chat`);
	// Si no se pudo leer el brain, se asume que está: una falla pasajera no
	// manda a Conectar a una empresa que ya lo tiene.
	redirect(`/${slug}${tenantHome({ enabledAgents, brain: brain ?? true })}`);
}
