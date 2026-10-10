import Link from "next/link";
import { notFound } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
	platformOwnerSlug,
	requirePlatformAdmin,
} from "@/lib/tenants/platform";
import { READINESS_LABELS, tenantReadiness } from "@/lib/tenants/readiness";

interface TenantListRow {
	id: string;
	slug: string;
	display_name: string;
	active: boolean;
	created_at: string;
}

export default async function PlataformaPage() {
	const admin = await requirePlatformAdmin();
	// 404 y no 403: un 403 confirma que la consola existe.
	if (!admin) notFound();

	// La RLS le muestra al platform_admin todos los tenants, activos o no, y
	// todas las memberships: de ahí sale la cantidad de usuarios.
	const [tenantsResult, membershipsResult, agentsResult, connectionsResult] =
		await Promise.all([
			admin.supabase
				.from("tenants")
				.select("id, slug, display_name, active, created_at")
				.order("display_name")
				.returns<TenantListRow[]>(),
			admin.supabase
				.from("memberships")
				.select("tenant_id")
				.returns<{ tenant_id: string }[]>(),
			admin.supabase
				.from("tenant_agents")
				.select("tenant_id, agent, enabled")
				.returns<{ tenant_id: string; agent: string; enabled: boolean }[]>(),
			admin.supabase
				.from("tenant_connections")
				.select("tenant_id, capability, provider, enabled, verified_at")
				.returns<
					{
						tenant_id: string;
						capability: string;
						provider: string;
						enabled: boolean;
						verified_at: string | null;
					}[]
				>(),
		]);

	const readError = agentsResult.error ?? connectionsResult.error;
	if (readError) {
		console.error("consola:", readError.code, readError.message);
	}
	const tenants = tenantsResult.data ?? [];
	const users = new Map<string, number>();
	for (const { tenant_id } of membershipsResult.data ?? []) {
		users.set(tenant_id, (users.get(tenant_id) ?? 0) + 1);
	}
	const agentsByTenant = new Map<
		string,
		{ agent: string; enabled: boolean }[]
	>();
	for (const { tenant_id, agent, enabled } of agentsResult.data ?? []) {
		agentsByTenant.set(tenant_id, [
			...(agentsByTenant.get(tenant_id) ?? []),
			{ agent, enabled },
		]);
	}
	const connectionsByTenant = new Map<
		string,
		{
			capability: string;
			provider: string;
			enabled: boolean;
			verifiedAt: string | null;
		}[]
	>();
	for (const row of connectionsResult.data ?? []) {
		connectionsByTenant.set(row.tenant_id, [
			...(connectionsByTenant.get(row.tenant_id) ?? []),
			{
				capability: row.capability,
				provider: row.provider,
				enabled: row.enabled,
				verifiedAt: row.verified_at,
			},
		]);
	}
	const ownerSlug = platformOwnerSlug();

	return (
		<div className="max-w-3xl">
			<div className="mb-4 flex items-center justify-between gap-3">
				<h1 className="text-3xl leading-tight">Empresas</h1>
				<Button asChild size="lg">
					<Link href="/plataforma/nueva">Nueva empresa</Link>
				</Button>
			</div>
			{tenants.length === 0 ? (
				<p className="text-muted-foreground text-sm">
					Todavía no hay empresas cargadas.
				</p>
			) : (
				<ul className="divide-y rounded-lg border bg-card">
					{tenants.map((tenant) => {
						const readiness = readError
							? null
							: tenantReadiness({
									agents: agentsByTenant.get(tenant.id) ?? [],
									connections: connectionsByTenant.get(tenant.id) ?? [],
								});
						return (
							<li key={tenant.id}>
								<Link
									href={`/plataforma/${tenant.slug}`}
									className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 transition-colors hover:bg-muted"
								>
									<div className="min-w-0 flex-1">
										<div className="truncate">{tenant.display_name}</div>
										<div className="truncate text-muted-foreground text-sm">
											{tenant.slug}
										</div>
									</div>
									{tenant.slug === ownerSlug ? (
										<span className="rounded-full border px-2 py-0.5 text-muted-foreground text-xs">
											Dueño de la plataforma
										</span>
									) : null}
									<span className="rounded-full border px-2 py-0.5 text-muted-foreground text-xs">
										{tenant.active ? "Activo" : "Inactivo"}
									</span>
									<span className="text-muted-foreground text-sm">
										{readiness === null
											? "No pude leer el estado"
											: readiness.ready
												? "Lista"
												: `Faltan: ${readiness.missing.map((issue) => READINESS_LABELS[issue]).join(", ")}`}
									</span>
									<span className="text-muted-foreground text-sm">
										{users.get(tenant.id) ?? 0}{" "}
										{users.get(tenant.id) === 1 ? "usuario" : "usuarios"}
									</span>
									<span className="text-muted-foreground text-sm">
										{new Date(tenant.created_at).toLocaleDateString("es-AR")}
									</span>
								</Link>
							</li>
						);
					})}
				</ul>
			)}
		</div>
	);
}
