import { headers } from "next/headers";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { DomainRow, DomainStatus } from "@/lib/domains/service";
import { supabaseAuthRedirectsFromEnv } from "@/lib/domains/supabase-auth";
import { vercelDomainsFromEnv } from "@/lib/domains/vercel";
import { loadDnsInstructions } from "@/lib/domains/view";
import { brainForTenant, loadIcpLevels, loadMarco } from "@/lib/outreach/canon";
import { isAuthMethod } from "@/lib/tenants/auth-methods";
import { knownWarnings } from "@/lib/tenants/create-warnings";
import { loadGatewayModels } from "@/lib/tenants/gateway-models";
import { originFrom } from "@/lib/tenants/origin";
import { loadPeople } from "@/lib/tenants/people";
import {
	platformOwnerSlug,
	requirePlatformAdmin,
} from "@/lib/tenants/platform";
import {
	agentsNeedCanon,
	canonState,
	READINESS_LABELS,
	tenantReadiness,
} from "@/lib/tenants/readiness";
import { brandFromRow, type TenantRole } from "@/lib/tenants/resolve";
import { ROLE_LABELS } from "@/lib/tenants/role-labels";
import { budgetResources, toBudgetRows } from "@/lib/workflows/settings";
import { AgentsSection } from "./console/agents-section";
import { BindForm } from "./console/bind-form";
import { BrainSection } from "./console/brain-section";
import { BudgetsSection } from "./console/budgets-section";
import { ConnectionsSection } from "./console/connections-section";
import { DomainSection, type DomainView } from "./console/domain-section";
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

	const [
		{ data: agentRows, error: agentsError },
		{ data: connectionRows, error: connectionsError },
	] = await Promise.all([
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
	const readError = agentsError ?? connectionsError;
	if (readError) {
		console.error("consola:", readError.code, readError.message);
	}
	// El ICP y el marco solo se leen acá, en el detalle: en el listado sería
	// una lectura del brain por empresa.
	const brainEnabled = connections.some(
		(c) => c.capability === "brain" && c.enabled,
	);
	let canon: Parameters<typeof tenantReadiness>[0]["canon"];
	let brainUnreadable = false;
	const canonNeeded = agentsNeedCanon(agents.filter((a) => a.enabled));
	if (!readError && brainEnabled) {
		try {
			const brain = await brainForTenant(tenant.id);
			const [icp, marco] = await Promise.all([
				loadIcpLevels(brain),
				loadMarco(brain),
			]);
			canon = { icp: canonState(icp), marco: canonState(marco) };
			brainUnreadable =
				(!icp.ok && icp.reason === "brain_caido") ||
				(!marco.ok && marco.reason === "brain_caido");
		} catch (error) {
			console.error("consola: no pude leer el brain:", error);
			brainUnreadable = true;
		}
	}
	const readiness = readError
		? null
		: tenantReadiness({ agents, connections, canon });

	// El día se corta en UTC: la consola no conoce la zona horaria del outreach
	// de cada empresa y no hace falta para fijar un tope.
	const dayStartUtc = new Date();
	dayStartUtc.setUTCHours(0, 0, 0, 0);
	const { data: budgetRows, error: budgetsError } = await admin.supabase.rpc(
		"tenant_budget_status",
		{
			p_tenant: tenant.id,
			p_resources: budgetResources(),
			p_since: dayStartUtc.toISOString(),
		} as never,
	);
	if (budgetsError) {
		console.error("consola:", budgetsError.code, budgetsError.message);
	}

	// Los dominios se leen con la sesión de plataforma (la RLS deja leer a
	// plataforma y a los miembros). Las instrucciones de DNS salen de Vercel y, si
	// Vercel falla o demora, ese dominio queda sin ellas: la página sigue.
	const vercelApi = vercelDomainsFromEnv(process.env);
	const { data: domainRows, error: domainsError } = await admin.supabase
		.from("tenant_domains")
		.select(
			"id, tenant_id, hostname, is_primary, status, last_error, verified_at, created_at",
		)
		.eq("tenant_id", tenant.id)
		.order("created_at");
	if (domainsError) {
		console.error("consola:", domainsError.code, domainsError.message);
	}
	const domainList: DomainRow[] = (domainRows ?? []).map((row) => ({
		id: row.id,
		tenantId: row.tenant_id,
		hostname: row.hostname,
		isPrimary: row.is_primary,
		status: row.status as DomainStatus,
		lastError: row.last_error,
		verifiedAt: row.verified_at,
		createdAt: row.created_at,
	}));
	const dnsById = await loadDnsInstructions(domainList, vercelApi);
	const domains: DomainView[] = domainList.map((row) => ({
		id: row.id,
		hostname: row.hostname,
		isPrimary: row.isPrimary,
		status: row.status,
		lastError: row.lastError,
		dns: dnsById.get(row.id) ?? null,
	}));

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
							href={`/${tenant.slug}`}
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
					catalog={await loadGatewayModels()}
				/>
			</section>

			<section>
				<h2 className="mb-3 text-lg">Qué falta</h2>
				{readiness === null ? (
					<p className="text-sm">No pude leer el estado. Probá de nuevo.</p>
				) : readiness.ready ? (
					<p className="text-sm">Lista para trabajar.</p>
				) : (
					<ul className="list-disc pl-5 text-sm">
						{readiness.missing.map((issue) => (
							<li key={issue}>{READINESS_LABELS[issue]}</li>
						))}
					</ul>
				)}
				{brainUnreadable && canonNeeded ? (
					<p className="mt-2 text-muted-foreground text-sm">
						No pude leer el brain: no sé si el ICP y los hooks están cargados.
					</p>
				) : null}
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

			<section className="space-y-3">
				<h2 className="text-lg">Dominio</h2>
				<DomainSection
					apiReady={{
						vercel: vercelApi !== null,
						supabase: supabaseAuthRedirectsFromEnv(process.env) !== null,
					}}
					domains={domains}
					readError={domainsError !== null}
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
				<h2 className="mb-3 text-lg">Presupuestos</h2>
				{budgetsError ? (
					<p className="text-muted-foreground text-sm">
						No pude leer esta sección. Recargá la página.
					</p>
				) : (
					<BudgetsSection
						budgets={toBudgetRows((budgetRows as unknown[] | null) ?? [])}
						slug={tenant.slug}
						tenantId={tenant.id}
					/>
				)}
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
