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
});

const fail = (message: string) => ({ ok: false as const, message });

export async function saveAccessStep(
	slug: string,
	input: { methods: string[] },
): Promise<{ ok: true } | { ok: false; message: string }> {
	const parsed = inputSchema.safeParse(input);
	if (!parsed.success) return fail("No se pudo procesar el pedido.");
	const g = await gateForStep(slug, "acceso");
	if (!g) return fail("No tenés permiso.");

	let done = false;
	try {
		// La restricción de dominio es un dato fijo (allowed_domains + el chequeo
		// de la invitación), no una opción de este paso.
		// saveAuthMethods rechaza sacar el método de la sesión.
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
