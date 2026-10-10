import { notFound } from "next/navigation";
import { createServerSupabase } from "@/lib/supabase/server";
import { loadPeople } from "@/lib/tenants/people";
import { resolveTenantAccess, type TenantRole } from "@/lib/tenants/resolve";
import { ROLE_LABELS } from "@/lib/tenants/role-labels";
import {
	blockMember,
	resendInvitation,
	revokeInvitation,
	revokeMembership,
	unblockMember,
} from "./actions";
import { InviteForm } from "./invite-form";
import { ActionButton, RoleSelect } from "./row-actions";

const fecha = (value: string) => new Date(value).toLocaleDateString("es-AR");

export default async function UsuariosPage({
	params,
}: {
	params: Promise<{ tenant: string }>;
}) {
	const { tenant: slug } = await params;
	const tenant = await resolveTenantAccess(slug);
	if (!tenant) notFound();
	if (tenant.role === "tenant_member") notFound();

	const supabase = await createServerSupabase();

	const [{ data: memberships }, { data: invitations }, { data: blocks }] =
		await Promise.all([
			supabase
				.from("memberships")
				.select("id, role, user_id")
				.eq("tenant_id", tenant.id),
			supabase
				.from("invitations")
				.select("id, email, role, expires_at")
				.eq("tenant_id", tenant.id)
				.eq("status", "pending"),
			supabase
				.from("membership_blocks")
				.select("tenant_id, user_id, created_at")
				.eq("tenant_id", tenant.id)
				.order("created_at", { ascending: false }),
		]);

	const people = await loadPeople([
		...(memberships ?? []).map(({ user_id }) => user_id),
		...(blocks ?? []).map(({ user_id }) => user_id),
	]);

	return (
		<div className="max-w-3xl space-y-10">
			<section>
				<h1 className="mb-4 text-3xl leading-tight">
					Usuarios de {tenant.displayName}
				</h1>
				<ul className="divide-y rounded-lg border bg-card empty:hidden">
					{(memberships ?? []).map((membership) => {
						const role = membership.role as TenantRole;
						const isSelf = membership.user_id === tenant.userId;
						return (
							<li
								key={membership.id}
								className="flex flex-wrap items-center gap-3 px-4 py-3"
							>
								<div className="min-w-0">
									<div>
										{people.get(membership.user_id)?.name || "Sin nombre"}
									</div>
									<div className="truncate text-muted-foreground text-sm">
										{people.get(membership.user_id)?.email}
									</div>
								</div>
								{role === "platform_admin" ? (
									<span className="text-muted-foreground text-sm">
										{ROLE_LABELS[role]}
									</span>
								) : (
									<RoleSelect
										membershipId={membership.id}
										slug={slug}
										role={role}
									/>
								)}
								<span className="ml-auto inline-flex flex-wrap items-center gap-2">
									<ActionButton
										label="Sacar"
										run={revokeMembership.bind(null, membership.id, slug)}
									/>
									{role === "platform_admin" || isSelf ? null : (
										<ActionButton
											confirmText="Esta persona no va a poder volver a entrar a la empresa, ni siquiera por el dominio, hasta que la desbloquees o la invites de nuevo."
											label="Bloquear"
											run={blockMember.bind(null, membership.id, slug)}
										/>
									)}
								</span>
							</li>
						);
					})}
				</ul>
			</section>

			{(blocks ?? []).length > 0 ? (
				<section>
					<h2 className="mb-3 text-lg">Bloqueados</h2>
					<ul className="divide-y rounded-lg border bg-card">
						{(blocks ?? []).map((block) => (
							<li
								key={block.user_id}
								className="flex flex-wrap items-center gap-3 px-4 py-3"
							>
								<div className="min-w-0">
									<div>{people.get(block.user_id)?.name || "Sin nombre"}</div>
									<div className="truncate text-muted-foreground text-sm">
										{people.get(block.user_id)?.email}
									</div>
								</div>
								<span className="text-muted-foreground text-sm">
									Desde el {fecha(block.created_at)}
								</span>
								<span className="ml-auto">
									<ActionButton
										label="Desbloquear"
										run={unblockMember.bind(
											null,
											block.tenant_id,
											block.user_id,
											slug,
										)}
									/>
								</span>
							</li>
						))}
					</ul>
				</section>
			) : null}

			<section>
				<h2 className="mb-3 text-lg">Invitaciones pendientes</h2>
				<ul className="divide-y rounded-lg border bg-card empty:hidden">
					{(invitations ?? []).map((invitation) => (
						<li
							key={invitation.id}
							className="flex flex-wrap items-center gap-3 px-4 py-3"
						>
							<span>{invitation.email}</span>
							<span className="text-muted-foreground text-sm">
								{ROLE_LABELS[invitation.role as TenantRole]}
							</span>
							<span className="ml-auto inline-flex flex-wrap items-center gap-2">
								<ActionButton
									label="Reenviar"
									run={resendInvitation.bind(null, invitation.id, slug)}
								/>
								<ActionButton
									label="Revocar"
									run={revokeInvitation.bind(null, invitation.id, slug)}
								/>
							</span>
						</li>
					))}
				</ul>
			</section>

			<InviteForm tenantId={tenant.id} />
		</div>
	);
}
