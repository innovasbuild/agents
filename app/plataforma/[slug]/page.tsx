import Link from "next/link";
import { notFound } from "next/navigation";
import { loadPeople } from "@/lib/tenants/people";
import {
	platformOwnerSlug,
	requirePlatformAdmin,
} from "@/lib/tenants/platform";
import { brandFromRow, type TenantRole } from "@/lib/tenants/resolve";
import { ROLE_LABELS } from "@/lib/tenants/role-labels";
import { TenantForm } from "./tenant-form";

interface TenantDetailRow {
	id: string;
	slug: string;
	display_name: string;
	allowed_domains: string[];
	self_signup_by_domain: boolean;
	allowed_models: string[];
	default_model: string;
	brand: Record<string, unknown>;
	active: boolean;
}

export default async function TenantDetailPage({
	params,
}: {
	params: Promise<{ slug: string }>;
}) {
	const { slug } = await params;
	const admin = await requirePlatformAdmin();
	if (!admin) notFound();

	// Sin filtro por `active`, a diferencia de resolveTenantAccess: un tenant
	// inactivo se abre acá, que es donde se lo reactiva.
	const { data: tenant } = await admin.supabase
		.from("tenants")
		.select(
			"id, slug, display_name, allowed_domains, self_signup_by_domain, allowed_models, default_model, brand, active",
		)
		.eq("slug", slug)
		.maybeSingle<TenantDetailRow>();
	if (!tenant) notFound();

	const { data: memberships } = await admin.supabase
		.from("memberships")
		.select("id, role, user_id")
		.eq("tenant_id", tenant.id)
		.returns<{ id: string; role: TenantRole; user_id: string }[]>();
	const people = await loadPeople(
		(memberships ?? []).map(({ user_id }) => user_id),
	);

	const brand = brandFromRow(tenant);
	const logoSrc = brand.logoUrl
		? `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/brand/${brand.logoUrl}`
		: null;

	return (
		<div className="max-w-3xl space-y-10">
			<section>
				<Link
					href="/plataforma"
					className="inline-flex min-h-11 items-center text-muted-foreground text-sm hover:text-foreground"
				>
					← Empresas
				</Link>
				<div className="mb-4 flex flex-wrap items-center gap-3">
					<h1 className="text-3xl leading-tight">{tenant.display_name}</h1>
					{tenant.active ? (
						<Link
							href={`/${tenant.slug}/chat`}
							className="inline-flex min-h-11 items-center text-sm underline underline-offset-4"
						>
							Abrir
						</Link>
					) : (
						<span className="rounded-full border px-2 py-0.5 text-muted-foreground text-xs">
							Inactivo
						</span>
					)}
				</div>
				<TenantForm
					// La key fuerza a remontar el form cuando la fila cambia tras
					// guardar: sin eso los defaultValue quedan con lo viejo.
					key={JSON.stringify(tenant)}
					tenant={{
						id: tenant.id,
						slug: tenant.slug,
						displayName: tenant.display_name,
						allowedDomains: tenant.allowed_domains,
						selfSignupByDomain: tenant.self_signup_by_domain,
						allowedModels: tenant.allowed_models,
						defaultModel: tenant.default_model,
						primary: brand.primary ?? "",
						secondary: brand.secondary ?? "",
						logoSrc,
						active: tenant.active,
					}}
					isOwner={tenant.slug === platformOwnerSlug()}
				/>
			</section>

			<section>
				<div className="mb-3 flex flex-wrap items-center gap-3">
					<h2 className="text-lg">Usuarios</h2>
					{tenant.active ? (
						<Link
							href={`/${tenant.slug}/settings/usuarios`}
							className="inline-flex min-h-11 items-center text-sm underline underline-offset-4"
						>
							Administrar
						</Link>
					) : null}
				</div>
				{(memberships ?? []).length === 0 ? (
					<p className="text-muted-foreground text-sm">
						Este cliente todavía no tiene usuarios.
					</p>
				) : (
					<ul className="divide-y rounded-lg border bg-card">
						{(memberships ?? []).map((membership) => (
							<li
								key={membership.id}
								className="flex items-center gap-3 px-4 py-3"
							>
								<div className="min-w-0 flex-1">
									<div>
										{people.get(membership.user_id)?.name || "Sin nombre"}
									</div>
									<div className="truncate text-muted-foreground text-sm">
										{people.get(membership.user_id)?.email}
									</div>
								</div>
								<span className="text-muted-foreground text-sm">
									{ROLE_LABELS[membership.role]}
								</span>
							</li>
						))}
					</ul>
				)}
			</section>
		</div>
	);
}
