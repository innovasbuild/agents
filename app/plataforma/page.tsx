import Link from "next/link";
import { notFound } from "next/navigation";
import {
	platformOwnerSlug,
	requirePlatformAdmin,
} from "@/lib/tenants/platform";

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
	const [tenantsResult, membershipsResult] = await Promise.all([
		admin.supabase
			.from("tenants")
			.select("id, slug, display_name, active, created_at")
			.order("display_name")
			.returns<TenantListRow[]>(),
		admin.supabase
			.from("memberships")
			.select("tenant_id")
			.returns<{ tenant_id: string }[]>(),
	]);

	const tenants = tenantsResult.data ?? [];
	const users = new Map<string, number>();
	for (const { tenant_id } of membershipsResult.data ?? []) {
		users.set(tenant_id, (users.get(tenant_id) ?? 0) + 1);
	}
	const ownerSlug = platformOwnerSlug();

	return (
		<div className="max-w-3xl">
			<h1 className="mb-4 text-3xl leading-tight">Empresas</h1>
			{tenants.length === 0 ? (
				<p className="text-muted-foreground text-sm">
					Todavía no hay empresas cargadas.
				</p>
			) : (
				<ul className="divide-y rounded-lg border bg-card">
					{tenants.map((tenant) => (
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
									{users.get(tenant.id) ?? 0} usuarios
								</span>
								<span className="text-muted-foreground text-sm">
									{new Date(tenant.created_at).toLocaleDateString("es-AR")}
								</span>
							</Link>
						</li>
					))}
				</ul>
			)}
		</div>
	);
}
