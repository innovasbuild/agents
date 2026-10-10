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

export type InvitationMailOutcome = "ok" | "ya_existe" | "mail_fallo";

/**
 * Manda el mail de invitación de Supabase. No toca `invitations`: quien llama
 * ya creó o renovó la fila. Si la persona ya tiene cuenta, Supabase no
 * reinvita y no hace falta: la invitación pendiente se acepta la próxima vez
 * que entre.
 */
export async function sendInvitationMail(params: {
	admin: SupabaseClient;
	email: string;
	origin: string;
	next?: string;
}): Promise<InvitationMailOutcome> {
	const redirectTo = params.next
		? `${params.origin}/auth/callback?next=${encodeURIComponent(params.next)}`
		: `${params.origin}/auth/callback`;

	const { error } = await params.admin.auth.admin.inviteUserByEmail(
		params.email,
		{ redirectTo },
	);
	if (!error) return "ok";

	if (error.code === "email_exists" || error.code === "user_already_exists") {
		console.warn("inviteUserByEmail:", error.message);
		return "ya_existe";
	}

	// Fallo real (rate limit, SMTP caído): la fila de invitations queda pendiente.
	console.error("inviteUserByEmail:", error.message);
	return "mail_fallo";
}

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

	const outcome = await sendInvitationMail({
		admin: params.admin,
		email,
		origin: params.origin,
		next: params.next,
	});
	return { kind: outcome };
}
