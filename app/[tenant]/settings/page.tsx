import Link from "next/link";
import { notFound } from "next/navigation";
import { AGENT_CATALOG, isCatalogAgent } from "@/lib/agents/catalog";
import {
	toConnectionRows,
	toExecutorRows,
} from "@/lib/outreach/settings-query";
import { createServerSupabase } from "@/lib/supabase/server";
import { approvableNodes, readPolicy } from "@/lib/tenants/approvals";
import { suggestExecutorSlug } from "@/lib/tenants/executor-slug";
import { loadPeople } from "@/lib/tenants/people";
import { resolveTenantAccess } from "@/lib/tenants/resolve";
import { ApprovalsSection } from "./config/approvals-section";
import { ConnectionsSection } from "./config/connections-section";
import { ExecutorsSection } from "./config/executors-section";
import { IngresoForm } from "./ingreso-form";
import { ModeloForm } from "./modelo-form";

const Unreadable = () => (
	<p className="text-muted-foreground text-sm">
		No pude leer esta sección. Recargá la página.
	</p>
);

export default async function SettingsPage({
	params,
}: {
	params: Promise<{ tenant: string }>;
}) {
	const { tenant: slug } = await params;
	const tenant = await resolveTenantAccess(slug);
	if (!tenant) notFound();
	// Mismo gate que /settings/usuarios: esta pantalla es territorio de admin,
	// aunque la RLS de executors/tenant_connections deje leer a cualquier
	// miembro.
	if (tenant.role === "tenant_member") notFound();

	const supabase = await createServerSupabase();
	const [
		executorsResult,
		connectionsResult,
		signupResult,
		membershipsResult,
		agentsResult,
	] = await Promise.all([
		supabase
			.from("executors")
			.select(
				"user_id, slug, daily_quota, gmail_authorized_at, display_name, title, linkedin_url, crm_owner_id",
			)
			.eq("tenant_id", tenant.id),
		// Sin connector_uid ni config: el cliente no los ve (spec 21.2 §5).
		supabase
			.from("tenant_connections")
			.select("id, capability, provider, enabled, locked_by_platform")
			.eq("tenant_id", tenant.id)
			.order("created_at"),
		supabase
			.from("tenants")
			.select("allowed_domains, self_signup_by_domain")
			.eq("id", tenant.id)
			.maybeSingle(),
		supabase.from("memberships").select("user_id").eq("tenant_id", tenant.id),
		supabase
			.from("tenant_agents")
			.select("agent, enabled, config")
			.eq("tenant_id", tenant.id),
	]);

	for (const [name, result] of [
		["executors", executorsResult],
		["memberships", membershipsResult],
		["tenant_agents", agentsResult],
		["tenant_connections", connectionsResult],
	] as const) {
		if (result.error)
			console.error(`settings: no pude leer ${name}:`, result.error);
	}
	const executorsFailed = Boolean(
		executorsResult.error || membershipsResult.error,
	);

	const executorRows = toExecutorRows(executorsResult.data ?? []);
	const memberIds = (membershipsResult.data ?? []).map(
		(row) => row.user_id as string,
	);
	const people = executorsFailed
		? new Map()
		: await loadPeople([
				...new Set([...memberIds, ...executorRows.map((row) => row.userId)]),
			]);
	const label = (userId: string) => {
		const person = people.get(userId);
		return person?.name || person?.email || userId;
	};

	const executors = executorRows.map((row) => ({
		userId: row.userId,
		person: label(row.userId),
		slug: row.slug ?? "",
		displayName: row.displayName ?? "",
		title: row.title ?? "",
		linkedinUrl: row.linkedinUrl ?? "",
		dailyQuota: row.dailyQuota,
		gmailAuthorized: Boolean(row.gmailAuthorizedAt),
		hasCrmOwner: Boolean(row.crmOwnerId),
	}));
	const taken = new Set(executorRows.map((row) => row.userId));
	const candidates = memberIds
		.filter((userId) => !taken.has(userId))
		.map((userId) => ({
			userId,
			person: label(userId),
			suggestedSlug: suggestExecutorSlug(people.get(userId)?.email),
		}));

	// La pantalla de outreach da 404 sin el agente habilitado.
	const outreachEnabled = (agentsResult.data ?? []).some(
		(row) => row.agent === "outreach" && row.enabled === true,
	);
	// Sin agentes no hay modelo, ejecutores, aprobaciones ni conectores que
	// configurar: quedan Ingreso y Usuarios (spec 21.4 §3.4). Si no se pudo leer,
	// se muestra todo.
	const hasAgents =
		Boolean(agentsResult.error) ||
		(agentsResult.data ?? []).some((row) => row.enabled === true);

	const approvals = (agentsResult.data ?? [])
		.filter((row) => row.enabled === true)
		.map((row) => {
			const agent = row.agent as string;
			return {
				agent,
				name: isCatalogAgent(agent) ? AGENT_CATALOG[agent].name : agent,
				nodes: approvableNodes(agent).map((node) => ({
					node,
					policy: readPolicy(row.config, node),
				})),
			};
		})
		.filter((entry) => entry.nodes.length > 0);

	const connections = toConnectionRows(connectionsResult.data ?? []);

	return (
		<div className="max-w-3xl space-y-10">
			<h1 className="text-3xl leading-tight">
				Configuración de {tenant.displayName}
			</h1>

			{hasAgents ? (
				<section>
					<h2 className="mb-3 text-lg">Modelo default</h2>
					<ModeloForm
						tenantId={tenant.id}
						slug={slug}
						defaultModel={tenant.defaultModel}
						allowedModels={tenant.allowedModels}
					/>
				</section>
			) : null}

			<section>
				<h2 className="mb-3 text-lg">Ingreso</h2>
				{signupResult.error ? (
					<p className="text-muted-foreground text-sm">
						No se pudo leer la configuración de ingreso. Recargá la página.
					</p>
				) : (
					<IngresoForm
						tenantId={tenant.id}
						slug={slug}
						open={signupResult.data?.self_signup_by_domain ?? false}
						domains={
							(signupResult.data?.allowed_domains as string[] | undefined) ?? []
						}
					/>
				)}
			</section>

			{hasAgents ? (
				<>
					<section>
						<h2 className="mb-3 text-lg">Ejecutores</h2>
						{executorsFailed ? (
							<Unreadable />
						) : (
							<ExecutorsSection
								candidates={candidates}
								executors={executors}
								slug={slug}
							/>
						)}
					</section>

					<section>
						<h2 className="mb-3 text-lg">Aprobaciones</h2>
						{agentsResult.error ? (
							<Unreadable />
						) : (
							<ApprovalsSection agents={approvals} slug={slug} />
						)}
					</section>

					<section>
						<h2 className="mb-3 text-lg">Conectores</h2>
						{connectionsResult.error ? (
							<Unreadable />
						) : (
							<ConnectionsSection connections={connections} slug={slug} />
						)}
					</section>
				</>
			) : null}

			{outreachEnabled ? (
				<Link
					className="mr-6 inline-block text-sm underline underline-offset-4"
					href={`/${slug}/settings/outreach`}
				>
					Outreach →
				</Link>
			) : null}
			<Link
				className="inline-block text-sm underline underline-offset-4"
				href={`/${slug}/settings/usuarios`}
			>
				Usuarios →
			</Link>
		</div>
	);
}
