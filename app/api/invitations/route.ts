import { NextResponse } from "next/server";
import { z } from "zod";
import { isAllowedDomain } from "@/lib/invitations/domain";
import { createAdminClient } from "@/lib/supabase/admin";
import { createServerSupabase } from "@/lib/supabase/server";

const bodySchema = z.object({
	tenantId: z.uuid(),
	email: z.email(),
	role: z.enum(["tenant_admin", "tenant_member"]),
	allowExternal: z.boolean().optional(),
});

export async function POST(request: Request) {
	const supabase = await createServerSupabase();
	const { data: auth } = await supabase.auth.getUser();
	if (!auth.user) {
		return NextResponse.json({ error: "no autenticado" }, { status: 401 });
	}

	let body: unknown;
	try {
		body = await request.json();
	} catch {
		return NextResponse.json({ error: "payload inválido" }, { status: 400 });
	}

	const parsed = bodySchema.safeParse(body);
	if (!parsed.success) {
		return NextResponse.json({ error: "payload inválido" }, { status: 400 });
	}
	const { tenantId, role, allowExternal } = parsed.data;
	const email = parsed.data.email.trim().toLowerCase();

	// La RLS ya limita lo que este usuario ve: si no es admin del tenant, no
	// hay fila y el pedido muere acá.
	const { data: membership } = await supabase
		.from("memberships")
		.select("role")
		.eq("tenant_id", tenantId)
		.eq("user_id", auth.user.id)
		.in("role", ["tenant_admin", "platform_admin"])
		.maybeSingle();

	const { data: isPlatformAdmin } = await supabase.rpc("is_platform_admin");

	if (!membership && !isPlatformAdmin) {
		return NextResponse.json({ error: "sin permiso" }, { status: 403 });
	}

	const admin = createAdminClient();

	const { data: tenant } = await admin
		.from("tenants")
		.select("slug, allowed_domains")
		.eq("id", tenantId)
		.single();

	if (!tenant) {
		return NextResponse.json({ error: "tenant inexistente" }, { status: 404 });
	}

	const external = !isAllowedDomain(email, tenant.allowed_domains);
	if (external && !allowExternal) {
		return NextResponse.json(
			{ error: "dominio_no_permitido", allowedDomains: tenant.allowed_domains },
			{ status: 422 },
		);
	}

	const { error: insertError } = await admin.from("invitations").insert({
		tenant_id: tenantId,
		email,
		role,
		invited_by: auth.user.id,
	});

	if (insertError) {
		return NextResponse.json(
			{ error: "ya hay una invitación pendiente" },
			{ status: 409 },
		);
	}

	if (external) {
		// El evento de auditoría se registra acá, al momento de crear la
		// invitación (que es cuando se tomó la decisión de permitir el
		// dominio externo), no atado a que el mail de invitación salga bien:
		// si inviteUserByEmail falla más abajo, la fila en `invitations`
		// queda igual y la excepción de dominio tiene que quedar registrada
		// una sola vez, sin importar el resultado del envío.
		await admin.from("events").insert({
			tenant_id: tenantId,
			actor_user_id: auth.user.id,
			type: "invitation.external",
			summary: `Invitación fuera de los dominios del cliente: ${email}`,
			payload: { email, role },
		});
	}

	const origin = new URL(request.url).origin;
	const { error: inviteError } = await admin.auth.admin.inviteUserByEmail(
		email,
		{
			redirectTo: `${origin}/auth/callback`,
		},
	);

	if (inviteError) {
		const alreadyExists =
			inviteError.code === "email_exists" ||
			inviteError.code === "user_already_exists";

		if (!alreadyExists) {
			// Fallo real (rate limit, SMTP caído, etc.), no "ya existe": no le
			// mentimos al caller devolviendo 201 como si el mail hubiera
			// salido. La fila en `invitations` queda pendiente igual.
			console.error("inviteUserByEmail:", inviteError.message);
			return NextResponse.json(
				{ error: "no se pudo enviar el mail de invitación" },
				{ status: 502 },
			);
		}

		// El usuario ya existe en Auth: no hace falta mail de alta, la
		// invitación pendiente se acepta la próxima vez que entre.
		console.warn("inviteUserByEmail:", inviteError.message);
	}

	return NextResponse.json({ ok: true }, { status: 201 });
}
