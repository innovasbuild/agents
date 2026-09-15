import { notFound } from "next/navigation";
import { Button } from "@/components/ui/button";
import { createServerSupabase } from "@/lib/supabase/server";
import { resolveTenantAccess } from "@/lib/tenants/resolve";
import { revokeInvitation, revokeMembership } from "./actions";
import { InviteForm } from "./invite-form";

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

	const { data: memberships } = await supabase
		.from("memberships")
		.select("id, role, user_id")
		.eq("tenant_id", tenant.id);

	const { data: invitations } = await supabase
		.from("invitations")
		.select("id, email, role, expires_at")
		.eq("tenant_id", tenant.id)
		.eq("status", "pending");

	return (
		<div className="max-w-3xl space-y-10">
			<section>
				<h1 className="mb-4 text-3xl leading-tight">
					Usuarios de {tenant.displayName}
				</h1>
				<ul className="divide-y rounded-lg border bg-card empty:hidden">
					{(memberships ?? []).map((membership) => (
						<li
							key={membership.id}
							className="flex items-center gap-3 px-4 py-3"
						>
							<span className="font-mono text-sm">{membership.user_id}</span>
							<span className="text-muted-foreground text-sm">
								{membership.role}
							</span>
							<form
								className="ml-auto"
								action={revokeMembership.bind(null, membership.id, slug)}
							>
								<Button type="submit" variant="outline" size="sm">
									Sacar
								</Button>
							</form>
						</li>
					))}
				</ul>
			</section>

			<section>
				<h2 className="mb-3 text-lg">Invitaciones pendientes</h2>
				<ul className="divide-y rounded-lg border bg-card empty:hidden">
					{(invitations ?? []).map((invitation) => (
						<li
							key={invitation.id}
							className="flex items-center gap-3 px-4 py-3"
						>
							<span>{invitation.email}</span>
							<span className="text-muted-foreground text-sm">
								{invitation.role}
							</span>
							<form
								className="ml-auto"
								action={revokeInvitation.bind(null, invitation.id, slug)}
							>
								<Button type="submit" variant="outline" size="sm">
									Revocar
								</Button>
							</form>
						</li>
					))}
				</ul>
			</section>

			<InviteForm tenantId={tenant.id} />
		</div>
	);
}
