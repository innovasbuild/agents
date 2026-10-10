"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { sendInvitationMail } from "@/lib/invitations/invite";
import { createAdminClient } from "@/lib/supabase/admin";
import { createServerSupabase } from "@/lib/supabase/server";
import { actionAllowsLogin } from "@/lib/tenants/login-check-server";
import { originFrom } from "@/lib/tenants/origin";

type Supabase = Awaited<ReturnType<typeof createServerSupabase>>;

export type ActionResult =
	| { ok: true; message?: string }
	| { ok: false; message: string };

const SIN_PERMISO: ActionResult = { ok: false, message: "No tenés permiso." };
const SIN_ADMIN: ActionResult = {
	ok: false,
	message: "La empresa no puede quedar sin administrador.",
};
const FALLO: ActionResult = {
	ok: false,
	message: "No se pudo completar. Probá de nuevo.",
};

const ASSIGNABLE_ROLES = ["tenant_admin", "tenant_member"] as const;
const INVITATION_DAYS = 14;

/** Traduce un error de Postgres a un mensaje; el detalle nunca sale de acá. */
function fromDbError(error: { code?: string; message: string }): ActionResult {
	if (error.code === "23514") return SIN_ADMIN;
	if (error.code === "42501") return SIN_PERMISO;
	console.error("usuarios:", error.message);
	return FALLO;
}

/**
 * La fila que toca la acción, leída con la sesión (la RLS aplica), y el
 * chequeo del método contra la empresa de esa fila (spec etapa 20, L10 a
 * L12). `null` sin sesión, si la fila no se ve o no se pudo leer, o si la
 * empresa no permite el método: quien llama no escribe nada.
 */
async function allowedRow<Row extends { tenant_id: string }>(
	supabase: Supabase,
	read: () => PromiseLike<{ data: unknown; error: unknown }>,
): Promise<{ userId: string; row: Row } | null> {
	const { data: auth } = await supabase.auth.getUser();
	if (!auth.user) return null;

	const { data, error } = await read();
	if (error || !data) return null;
	const row = data as Row;

	if (!(await actionAllowsLogin(supabase, auth.user.id, row.tenant_id))) {
		return null;
	}
	return { userId: auth.user.id, row };
}

function done(slug: string, result: ActionResult): ActionResult {
	revalidatePath(`/${slug}/settings/usuarios`);
	return result;
}

export async function revokeMembership(
	membershipId: string,
	slug: string,
): Promise<ActionResult> {
	const supabase = await createServerSupabase();
	const allowed = await allowedRow(supabase, () =>
		supabase
			.from("memberships")
			.select("tenant_id")
			.eq("id", membershipId)
			.maybeSingle(),
	);
	if (!allowed) return done(slug, SIN_PERMISO);

	// La RLS decide: si no sos admin del tenant, no borra nada.
	const { data, error } = await supabase
		.from("memberships")
		.delete()
		.eq("id", membershipId)
		.select("id");
	if (error) return done(slug, fromDbError(error));
	// Cero filas: la RLS no dejó borrar.
	if (!data || data.length === 0) return done(slug, SIN_PERMISO);
	return done(slug, { ok: true });
}

export async function revokeInvitation(
	invitationId: string,
	slug: string,
): Promise<ActionResult> {
	const supabase = await createServerSupabase();
	const allowed = await allowedRow(supabase, () =>
		supabase
			.from("invitations")
			.select("tenant_id")
			.eq("id", invitationId)
			.maybeSingle(),
	);
	if (!allowed) return done(slug, SIN_PERMISO);

	const { data, error } = await supabase
		.from("invitations")
		.update({ status: "revoked" })
		.eq("id", invitationId)
		.select("id");
	if (error) return done(slug, fromDbError(error));
	// Cero filas: la RLS no dejó revocar.
	if (!data || data.length === 0) return done(slug, SIN_PERMISO);
	return done(slug, { ok: true });
}

export async function changeMemberRole(
	membershipId: string,
	role: string,
	slug: string,
): Promise<ActionResult> {
	if (!(ASSIGNABLE_ROLES as readonly string[]).includes(role)) {
		return SIN_PERMISO;
	}
	const supabase = await createServerSupabase();
	const allowed = await allowedRow<{ tenant_id: string; role: string }>(
		supabase,
		() =>
			supabase
				.from("memberships")
				.select("tenant_id, user_id, role")
				.eq("id", membershipId)
				.maybeSingle(),
	);
	if (!allowed) return SIN_PERMISO;
	if (allowed.row.role === "platform_admin") {
		return {
			ok: false,
			message:
				"No se puede cambiar el rol de un administrador de la plataforma.",
		};
	}

	const { data, error } = await supabase
		.from("memberships")
		.update({ role: role as (typeof ASSIGNABLE_ROLES)[number] })
		.eq("id", membershipId)
		.select("id");
	if (error) return done(slug, fromDbError(error));
	// Cero filas: la RLS no dejó escribir.
	if (!data || data.length === 0) return done(slug, SIN_PERMISO);
	return done(slug, { ok: true });
}

export async function blockMember(
	membershipId: string,
	slug: string,
): Promise<ActionResult> {
	const supabase = await createServerSupabase();
	const allowed = await allowedRow<{ tenant_id: string; user_id: string }>(
		supabase,
		() =>
			supabase
				.from("memberships")
				.select("tenant_id, user_id, role")
				.eq("id", membershipId)
				.maybeSingle(),
	);
	if (!allowed) return SIN_PERMISO;
	if (allowed.row.user_id === allowed.userId) {
		return { ok: false, message: "No podés bloquearte a vos." };
	}

	const { error } = await supabase.rpc("block_member", {
		p_tenant: allowed.row.tenant_id,
		p_user: allowed.row.user_id,
	});
	return done(slug, error ? fromDbError(error) : { ok: true });
}

export async function unblockMember(
	tenantId: string,
	userId: string,
	slug: string,
): Promise<ActionResult> {
	const supabase = await createServerSupabase();
	// Un bloqueo no tiene id propio. Se lee con la sesión: si no se ve, quien
	// llama no es administrador de esa empresa.
	const allowed = await allowedRow<{ tenant_id: string; user_id: string }>(
		supabase,
		() =>
			supabase
				.from("membership_blocks")
				.select("tenant_id, user_id")
				.eq("tenant_id", tenantId)
				.eq("user_id", userId)
				.maybeSingle(),
	);
	if (!allowed) return SIN_PERMISO;

	const { error } = await supabase.rpc("unblock_member", {
		p_tenant: allowed.row.tenant_id,
		p_user: allowed.row.user_id,
	});
	return done(slug, error ? fromDbError(error) : { ok: true });
}

export async function resendInvitation(
	invitationId: string,
	slug: string,
): Promise<ActionResult> {
	const supabase = await createServerSupabase();
	const allowed = await allowedRow<{
		tenant_id: string;
		email: string;
		status: string;
	}>(supabase, () =>
		supabase
			.from("invitations")
			.select("tenant_id, email, status")
			.eq("id", invitationId)
			.maybeSingle(),
	);
	if (!allowed || allowed.row.status !== "pending") return SIN_PERMISO;

	const expiresAt = new Date(
		Date.now() + INVITATION_DAYS * 24 * 60 * 60 * 1000,
	).toISOString();
	const { data: renewed, error } = await supabase
		.from("invitations")
		.update({ expires_at: expiresAt })
		.eq("id", invitationId)
		.eq("status", "pending")
		.select("id");
	if (error) return done(slug, fromDbError(error));
	if (!renewed || renewed.length === 0) return done(slug, SIN_PERMISO);

	// El link lleva al chat de la empresa de la invitación: el slug sale de la
	// base, no del parámetro que manda el navegador.
	const { data: tenant } = await supabase
		.from("tenants")
		.select("slug")
		.eq("id", allowed.row.tenant_id)
		.maybeSingle();

	const outcome = await sendInvitationMail({
		admin: createAdminClient(),
		email: allowed.row.email,
		origin: originFrom(await headers()),
		next: tenant?.slug ? `/${tenant.slug}/chat` : undefined,
	});

	if (outcome === "mail_fallo") {
		return done(slug, {
			ok: false,
			message: "No se pudo mandar el mail. Probá de nuevo.",
		});
	}
	return done(slug, {
		ok: true,
		message:
			outcome === "ya_existe"
				? "Esa persona ya tiene cuenta. Pasale el link de ingreso de la empresa."
				: "Invitación reenviada.",
	});
}
