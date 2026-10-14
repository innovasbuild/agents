import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { publicSettings } from "@/lib/brain/adapters/mcp-production";
import { type MemberSkill, memberSkills } from "@/lib/brain/adapters/skills";
import {
	buildConnectables,
	type Connectable,
} from "@/lib/connect/connectables";
import { createServerSupabase } from "@/lib/supabase/server";
import { requestHostContext } from "@/lib/tenants/host-store";
import { resolveTenantAccess, type TenantAccess } from "@/lib/tenants/resolve";
import { ConnectCard } from "./connect-card";
import { SkillsSection } from "./skills-section";

// Lo que la empresa le habilitó a esta persona para conectar a su cliente MCP
// (spec etapa 19 §4). Lee con la sesión del usuario: la RLS de tenant_agents
// y tenant_connections ya deja leer a cualquier miembro. Devuelve null si
// algo falla: una lista vacía por un error parecería "no tenés nada".
async function loadConnectables(
	tenantId: string,
	slug: string,
): Promise<Connectable[] | null> {
	try {
		const supabase = await createServerSupabase();
		const [agents, brain] = await Promise.all([
			supabase
				.from("tenant_agents")
				.select("agent")
				.eq("tenant_id", tenantId)
				.eq("enabled", true)
				.order("agent"),
			supabase
				.from("tenant_connections")
				.select("id")
				.eq("tenant_id", tenantId)
				.eq("capability", "brain")
				.eq("enabled", true)
				.limit(1),
		]);
		if (agents.error || brain.error) return null;

		// Por el dominio de la empresa las URLs salen con ese dominio y sin slug.
		// Si el host no se puede resolver, las de siempre: mejor eso que no
		// mostrar nada.
		const host = await requestHostContext(await headers()).catch((error) => {
			console.error("conectar: no pude resolver el host", error);
			return { publicUrl: "", tenantHost: false };
		});

		return buildConnectables({
			slug,
			publicUrl: host.tenantHost ? host.publicUrl : publicSettings().publicUrl,
			tenantHost: host.tenantHost,
			hasBrain: (brain.data ?? []).length > 0,
			enabledAgents: (agents.data ?? []).map((row) => row.agent as string),
		});
	} catch (error) {
		console.error("conectar: no pude armar las conexiones", error);
		return null;
	}
}

// Las skills se leen aparte: si fallan, la persona igual ve sus conexiones.
async function loadSkills(tenant: TenantAccess): Promise<MemberSkill[] | null> {
	try {
		return await memberSkills({
			tenantId: tenant.id,
			userId: tenant.userId,
			role: tenant.role,
		});
	} catch (error) {
		console.error("conectar: no pude leer las skills", error);
		return null;
	}
}

export default async function ConectarPage({
	params,
}: {
	params: Promise<{ tenant: string }>;
}) {
	const { tenant: slug } = await params;
	const tenant = await resolveTenantAccess(slug);
	if (!tenant) notFound();

	const connectables = await loadConnectables(tenant.id, tenant.slug);
	const hasBrain =
		connectables?.some((connectable) => connectable.kind === "brain") ?? false;
	const skills = hasBrain ? await loadSkills(tenant) : [];
	const nothingEnabled =
		connectables?.every((connectable) => connectable.kind === "tools") ?? false;

	return (
		<div className="max-w-3xl space-y-6">
			<header className="space-y-2">
				<h1 className="text-3xl leading-tight">Conectá tus herramientas</h1>
				<p className="text-muted-foreground text-sm">
					Estas son las conexiones que tu empresa te habilitó. Al conectar vas a
					entrar con tu cuenta de la plataforma y vas a ver solo lo que tu
					cuenta tiene permitido.
				</p>
			</header>

			{connectables === null ? (
				<p className="text-muted-foreground text-sm">
					No se pudieron leer tus conexiones. Recargá la página.
				</p>
			) : (
				<>
					{nothingEnabled ? (
						<p className="text-muted-foreground text-sm">
							Tu empresa todavía no tiene conexiones habilitadas.
						</p>
					) : null}
					{connectables.map((connectable) => (
						<ConnectCard
							key={connectable.kind === "tools" ? "tools" : connectable.id}
							connectable={connectable}
						/>
					))}
					{skills === null || skills.length > 0 ? (
						<SkillsSection tenantSlug={tenant.slug} skills={skills} />
					) : null}
				</>
			)}
		</div>
	);
}
