import Link from "next/link";
import { notFound } from "next/navigation";
import {
	toConnectionRows,
	toExecutorRows,
} from "@/lib/outreach/settings-query";
import { createServerSupabase } from "@/lib/supabase/server";
import { resolveTenantAccess } from "@/lib/tenants/resolve";
import { ModeloForm } from "./modelo-form";

const fecha = (value: string | null) =>
	value ? new Date(value).toLocaleDateString("es-AR") : "—";

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
	const [executorsResult, connectionsResult] = await Promise.all([
		supabase
			.from("executors")
			.select("user_id, slug, daily_quota, gmail_authorized_at")
			.eq("tenant_id", tenant.id),
		supabase
			.from("tenant_connections")
			.select("id, capability, provider, enabled")
			.eq("tenant_id", tenant.id),
	]);

	const executors = toExecutorRows(executorsResult.data ?? []);
	const connections = toConnectionRows(connectionsResult.data ?? []);

	return (
		<div className="max-w-3xl space-y-10">
			<section>
				<h1 className="mb-4 text-3xl leading-tight">
					Configuración de {tenant.displayName}
				</h1>
				<h2 className="mb-3 text-lg">Modelo default</h2>
				<ModeloForm
					tenantId={tenant.id}
					slug={slug}
					defaultModel={tenant.defaultModel}
					allowedModels={tenant.allowedModels}
				/>
			</section>

			<section>
				<h2 className="mb-3 text-lg">Ejecutores</h2>
				<p className="mb-3 text-muted-foreground text-sm">
					Cupo diario y conexiones se editan por ahora con{" "}
					<code className="rounded bg-muted px-1 py-0.5 text-xs">
						npm run executors:set
					</code>
					.
				</p>
				<ul className="divide-y rounded-lg border bg-card empty:hidden">
					{executors.map((executor) => (
						<li
							key={executor.userId}
							className="flex flex-wrap items-center gap-3 px-4 py-3"
						>
							<span className="font-medium text-sm">
								{executor.slug ?? executor.userId}
							</span>
							<span className="text-muted-foreground text-sm">
								{executor.dailyQuota} por día
							</span>
							<span className="ml-auto text-muted-foreground text-xs">
								{executor.gmailAuthorizedAt
									? `Gmail autorizado ${fecha(executor.gmailAuthorizedAt)}`
									: "Sin autorizar Gmail"}
							</span>
						</li>
					))}
				</ul>
				{executors.length === 0 ? (
					<p className="text-muted-foreground text-sm">
						Todavía no hay ejecutores configurados.
					</p>
				) : null}
			</section>

			<section>
				<h2 className="mb-3 text-lg">Conexiones</h2>
				<ul className="divide-y rounded-lg border bg-card empty:hidden">
					{connections.map((connection) => (
						<li
							key={connection.id}
							className="flex items-center gap-3 px-4 py-3"
						>
							<span className="font-medium text-sm">{connection.provider}</span>
							<span className="text-muted-foreground text-sm">
								{connection.capability}
							</span>
							<span
								className={
									connection.enabled
										? "ml-auto text-sm"
										: "ml-auto text-muted-foreground text-sm"
								}
							>
								{connection.enabled ? "Habilitada" : "Deshabilitada"}
							</span>
						</li>
					))}
				</ul>
				{connections.length === 0 ? (
					<p className="text-muted-foreground text-sm">
						Todavía no hay conexiones configuradas.
					</p>
				) : null}
			</section>

			<Link
				className="inline-block text-sm underline underline-offset-4"
				href={`/${slug}/settings/usuarios`}
			>
				Usuarios →
			</Link>
		</div>
	);
}
