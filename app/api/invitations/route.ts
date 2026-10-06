import { NextResponse } from "next/server";
import { z } from "zod";
import { inviteToTenant } from "@/lib/invitations/invite";
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

	const outcome = await inviteToTenant({
		admin: createAdminClient(),
		tenantId,
		email,
		role,
		invitedBy: auth.user.id,
		allowExternal: allowExternal ?? false,
		origin: new URL(request.url).origin,
	});

	// Mismos códigos que antes del refactor: el InviteForm del tenant depende
	// del 422 con allowedDomains para ofrecer "permitir correo externo".
	switch (outcome.kind) {
		case "tenant_inexistente":
			return NextResponse.json(
				{ error: "tenant inexistente" },
				{ status: 404 },
			);
		case "dominio_no_permitido":
			return NextResponse.json(
				{
					error: "dominio_no_permitido",
					allowedDomains: outcome.allowedDomains,
				},
				{ status: 422 },
			);
		case "duplicada":
			return NextResponse.json(
				{ error: "ya hay una invitación pendiente" },
				{ status: 409 },
			);
		case "mail_fallo":
			return NextResponse.json(
				{ error: "no se pudo enviar el mail de invitación" },
				{ status: 502 },
			);
		case "ok":
		case "ya_existe":
			return NextResponse.json({ ok: true }, { status: 201 });
	}
}
