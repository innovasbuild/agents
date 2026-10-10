import { headers } from "next/headers";
import Link from "next/link";
import { notFound } from "next/navigation";
import { isAuthMethod } from "@/lib/tenants/auth-methods";
import { knownWarnings } from "@/lib/tenants/create-warnings";
import { originFrom } from "@/lib/tenants/origin";
import { loadPeople } from "@/lib/tenants/people";
import {
	platformOwnerSlug,
	requirePlatformAdmin,
} from "@/lib/tenants/platform";
import { READINESS_LABELS, tenantReadiness } from "@/lib/tenants/readiness";
import { brandFromRow, type TenantRole } from "@/lib/tenants/resolve";
import { ROLE_LABELS } from "@/lib/tenants/role-labels";
import { AgentsSection } from "./console/agents-section";
import { BindForm } from "./console/bind-form";
import { BrainSection } from "./console/brain-section";
import { ConnectionsSection } from "./console/connections-section";
import { TenantForm } from "./tenant-form";

interface TenantDetailRow {
	id: string;
	slug: string;
	display_name: string;
	allowed_domains: string[];
	self_signup_by_domain: boolean;
	allowed_models: string[];
	default_model: string;
	auth_methods: string[];
	brand: Record<string, unknown>;
	active: boolean;
}

export default async function TenantDetailPage({
	params,
	searchParams,
}: {
	params: Promise<{ slug: string }>;
	searchParams: Promise<{ aviso?: string | string[] }>;
}) {
	const { slug } = await params;
	const { aviso } = await searchParams;
	// Advertencias del alta: la empresa se creó pero algo no transaccional
	// (logo, invitación) falló. Viajan en la URL porque esta página es de servidor.
	const avisos = knownWarnings(
		aviso ? (Array.isArray(aviso) ? aviso : [aviso]) : [],
	);
	const admin = await requirePlatformAdmin();
	if (!admin) notFound();

	// Sin filtro por `active`, a diferencia de resolveTenantAccess: un tenant
	// inactivo se abre acá, que es donde se lo reactiva.
	const { data: tenant } = await admin.supabase
		.from("tenants")
		.select(
			"id, slug, display_name, allowed_domains, self_signup_by_domain, allowed_models, default_model, auth_methods, brand, active",
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

	const [{ data: agentRows }, { data: connectionRows }] = await Promise.all([
		admin.supabase
			.from("tenant_agents")
			.select("agent, enabled, config")
			.eq("tenant_id", tenant.id),
		admin.supabase
			.from("tenant_connections")
			.select(
				"id, capability, provider, connector_uid, config, enabled, verified_at, verified_name, created_at",
			)
			.eq("tenant_id", tenant.id)
			.order("created_at"),
	]);
	const agents = (agentRows ?? []).map((row) => ({
		agent: row.agent as string,
		enabled: row.enabled === true,
		brain:
			((row.config as { brain?: unknown } | null)?.brain as
				| string
				| undefined) ?? "none",
	}));
	const connections = (connectionRows ?? []).map((row) => {
		const extra = (row.config as { connectorUids?: unknown } | null)
			?.connectorUids;
		return {
			id: row.id as string,
			capability: row.capability as string,
			provider: row.provider as string,
			connectorUids: [
				...new Set([
					...(typeof row.connector_uid === "string" ? [row.connector_uid] : []),
					...(Array.isArray(extra)
						? extra.filter((u): u is string => typeof u === "string")
						: []),
				]),
			],
			enabled: row.enabled === true,
			verifiedAt: (row.verified_at as string | null) ?? null,
			verifiedName: (row.verified_name as string | null) ?? null,
			createdAt: row.created_at as string,
			categories:
				((row.config as { categories?: unknown } | null)?.categories as
					| string[]
					| undefined) ?? [],
		};
	});
	// Cualquier fila de brain, habilitada o no: si se filtrara por enabled, un
	// brain deshabilitado ofrecería "Crear brain" y createBrain pisaría su config.
	const brainRow = connections.find((c) => c.capability === "brain") ?? null;
	const readiness = tenantReadiness({ agents, connections });

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
				<p className="mb-4 text-muted-foreground text-sm">
					Landing de login:{" "}
					<code className="rounded bg-muted px-1 py-0.5 text-xs">
						{originFrom(await headers())}/login/{tenant.slug}
					</code>
				</p>
				{avisos.length > 0 ? (
					<ul
						role="alert"
						className="mb-4 space-y-1 rounded-lg border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm"
					>
						<li>La empresa quedó creada, pero:</li>
						{avisos.map((texto) => (
							<li key={texto}>· {texto}</li>
						))}
					</ul>
				) : null}
				<TenantForm
					tenant={{
						id: tenant.id,
						slug: tenant.slug,
						displayName: tenant.display_name,
						allowedDomains: tenant.allowed_domains,
						selfSignupByDomain: tenant.self_signup_by_domain,
						allowedModels: tenant.allowed_models,
						defaultModel: tenant.default_model,
						authMethods: tenant.auth_methods.filter(isAuthMethod),
						primary: brand.primary ?? "",
						secondary: brand.secondary ?? "",
						logoSrc,
						active: tenant.active,
					}}
					isOwner={tenant.slug === platformOwnerSlug()}
				/>
			</section>

			<section>
				<h2 className="mb-3 text-lg">Qué falta</h2>
				{readiness.ready ? (
					<p className="text-sm">Lista para trabajar.</p>
				) : (
					<ul className="list-disc pl-5 text-sm">
						{readiness.missing.map((issue) => (
							<li key={issue}>{READINESS_LABELS[issue]}</li>
						))}
					</ul>
				)}
			</section>

			<section>
				<h2 className="mb-3 text-lg">Agentes</h2>
				<AgentsSection
					agents={agents}
					slug={tenant.slug}
					tenantId={tenant.id}
				/>
			</section>

			<section>
				<h2 className="mb-3 text-lg">Brain</h2>
				<BrainSection
					brain={
						brainRow
							? {
									provider: brainRow.provider,
									categories: brainRow.categories,
									createdAt: brainRow.createdAt,
									enabled: brainRow.enabled,
								}
							: null
					}
					slug={tenant.slug}
					tenantId={tenant.id}
				/>
			</section>

			<section className="space-y-4">
				<h2 className="text-lg">Conectores</h2>
				<ConnectionsSection
					connections={connections.filter((c) => c.capability !== "brain")}
					slug={tenant.slug}
					tenantId={tenant.id}
				/>
				<BindForm slug={tenant.slug} tenantId={tenant.id} />
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
