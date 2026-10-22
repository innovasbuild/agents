"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { invitationOrigin } from "@/lib/domains/origin";
import { inviteToTenant } from "@/lib/invitations/invite";
import { gateForStep } from "@/lib/onboarding/step-gate";
import { createAdminClient } from "@/lib/supabase/admin";
import { createServerSupabase } from "@/lib/supabase/server";
import { originFrom } from "@/lib/tenants/origin";

// Con el plan gratis entran 3 personas, contando a quien crea la empresa.
const MAX_INVITES = 2;

const invitesSchema = z
	.array(
		z.object({
			email: z.email(),
			role: z.enum(["tenant_admin", "tenant_member"]),
		}),
	)
	.max(MAX_INVITES);

const fail = (message: string) => ({ ok: false as const, message });

async function finish(tenantId: string): Promise<boolean> {
	const supabase = await createServerSupabase();
	const { error } = await supabase.rpc("set_onboarding_step", {
		p_tenant: tenantId,
		p_step: null,
	});
	if (error) console.error("set_onboarding_step falló", tenantId, error);
	return !error;
}

export async function finishWithInvites(
	slug: string,
	invites: { email: string; role: "tenant_admin" | "tenant_member" }[],
): Promise<{ ok: true; failed: string[] } | { ok: false; message: string }> {
	const parsed = invitesSchema.safeParse(invites);
	if (!parsed.success)
		return fail(
			`Podés invitar hasta ${MAX_INVITES} personas. Revisá los correos.`,
		);
	const g = await gateForStep(slug, "equipo");
	if (!g) return fail("No tenés permiso.");

	const failed: string[] = [];
	try {
		const admin = createAdminClient();
		const origin = await invitationOrigin(
			g.access.id,
			originFrom(await headers()),
		);
		for (const invite of parsed.data) {
			const email = invite.email.trim().toLowerCase();
			try {
				const outcome = await inviteToTenant({
					admin,
					tenantId: g.access.id,
					email,
					role: invite.role,
					invitedBy: g.access.userId,
					allowExternal: false,
					origin,
				});
				if (outcome.kind !== "ok" && outcome.kind !== "ya_existe")
					failed.push(email);
			} catch (error) {
				console.error("finishWithInvites: invitación falló", error);
				failed.push(email);
			}
		}
		if (!(await finish(g.access.id)))
			return fail("No pudimos terminar. Probá de nuevo.");
	} catch (error) {
		console.error("finishWithInvites falló", error);
		return fail("No pudimos mandar las invitaciones. Probá de nuevo.");
	}
	// Si alguna no salió, la persona tiene que enterarse: no se redirige.
	if (failed.length === 0) redirect(`/${slug}/chat`);
	return { ok: true, failed };
}

export async function finishWithoutInvites(slug: string): Promise<void> {
	const g = await gateForStep(slug, "equipo");
	if (!g) redirect("/empezar");
	if (!(await finish(g.access.id))) throw new Error("No pudimos terminar.");
	redirect(`/${slug}/chat`);
}
