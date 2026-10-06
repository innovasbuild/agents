import type { SupabaseClient } from "@supabase/supabase-js";
import { isAllowedDomain } from "@/lib/invitations/domain";

export type InviteRole = "tenant_admin" | "tenant_member";

export type InviteOutcome =
	| { kind: "ok" }
	| { kind: "ya_existe" }
	| { kind: "dominio_no_permitido"; allowedDomains: string[] }
	| { kind: "duplicada" }
	| { kind: "mail_fallo" }
	| { kind: "tenant_inexistente" };

/**
 * Invita a un correo a un tenant. Corre con el cliente admin: quien llama ya
 * verificó que puede invitar (RLS en la ruta, requirePlatformAdmin en la
 * consola). La fila de `invitations` se convierte en membership cuando el
 * usuario entra con ese mail (accept_pending_invitations).
 */
export async function inviteToTenant(params: {
	admin: SupabaseClient;
	tenantId: string;
	email: string;
	role: InviteRole;
	invitedBy: string;
	allowExternal: boolean;
	origin: string;
	next?: string;
}): Promise<InviteOutcome> {
	const email = params.email.trim().toLowerCase();

	const { data: tenant } = await params.admin
		.from("tenants")
		.select("slug, allowed_domains")
		.eq("id", params.tenantId)
		.single();
	if (!tenant) return { kind: "tenant_inexistente" };

	const external = !isAllowedDomain(email, tenant.allowed_domains);
	if (external && !params.allowExternal)
		return {
			kind: "dominio_no_permitido",
			allowedDomains: tenant.allowed_domains,
		};

	const { error: insertError } = await params.admin.from("invitations").insert({
		tenant_id: params.tenantId,
		email,
		role: params.role,
		invited_by: params.invitedBy,
	});
	if (insertError) return { kind: "duplicada" };

	if (external) {
		// Se registra al crear la invitación, que es cuando se decidió permitir
		// el dominio externo, sin importar si el mail después sale o no.
		await params.admin.from("events").insert({
			tenant_id: params.tenantId,
			actor_user_id: params.invitedBy,
			type: "invitation.external",
			summary: `Invitación fuera de los dominios del cliente: ${email}`,
			payload: { email, role: params.role },
		});
	}

	const redirectTo = params.next
		? `${params.origin}/auth/callback?next=${encodeURIComponent(params.next)}`
		: `${params.origin}/auth/callback`;

	const { error: inviteError } =
		await params.admin.auth.admin.inviteUserByEmail(email, { redirectTo });
	if (!inviteError) return { kind: "ok" };

	const alreadyExists =
		inviteError.code === "email_exists" ||
		inviteError.code === "user_already_exists";
	if (alreadyExists) {
		// Ya está en Auth: no hace falta mail de alta, la invitación pendiente se
		// acepta la próxima vez que entre.
		console.warn("inviteUserByEmail:", inviteError.message);
		return { kind: "ya_existe" };
	}

	// Fallo real (rate limit, SMTP caído): la fila de invitations queda pendiente.
	console.error("inviteUserByEmail:", inviteError.message);
	return { kind: "mail_fallo" };
}
