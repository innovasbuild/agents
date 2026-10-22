"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { fromDbError } from "@/app/[tenant]/settings/action-helpers";
import { saveAuthMethods } from "@/app/[tenant]/settings/perfil-actions";
import { gateForStep } from "@/lib/onboarding/step-gate";
import { stepPath } from "@/lib/onboarding/steps";
import { createServerSupabase } from "@/lib/supabase/server";

const inputSchema = z.object({
	methods: z.array(z.string()).max(10),
	restrictToDomain: z.boolean(),
});

const fail = (message: string) => ({ ok: false as const, message });

export async function saveAccessStep(
	slug: string,
	input: { methods: string[]; restrictToDomain: boolean },
): Promise<{ ok: true } | { ok: false; message: string }> {
	const parsed = inputSchema.safeParse(input);
	if (!parsed.success) return fail("No se pudo procesar el pedido.");
	const g = await gateForStep(slug, "acceso");
	if (!g) return fail("No tenés permiso.");

	let done = false;
	try {
		// `restrictToDomain` queda como está: allowed_domains no se toca. La
		// casilla "Solo correos @dominio" destildada solo avisa que la persona va
		// a invitar a alguien de afuera, y eso se decide al invitar (tilde
		// "Permitir correo externo", como hoy), no acá.
		const saved = await saveAuthMethods(slug, parsed.data.methods);
		if (!saved.ok) return saved;
		const supabase = await createServerSupabase();
		const { error } = await supabase.rpc("set_onboarding_step", {
			p_tenant: g.access.id,
			p_step: "equipo",
		});
		if (error) return fromDbError(error);
		done = true;
	} catch (error) {
		console.error("saveAccessStep falló", error);
		return fail("No se pudo guardar. Probá de nuevo.");
	}
	if (done) redirect(stepPath(slug, "equipo"));
	return { ok: true };
}
