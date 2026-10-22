"use server";

import { redirect } from "next/navigation";
import { saveLogo } from "@/app/[tenant]/settings/perfil-actions";
import { gateForStep } from "@/lib/onboarding/step-gate";
import { stepPath } from "@/lib/onboarding/steps";
import { createServerSupabase } from "@/lib/supabase/server";

const NOT_ALLOWED = "No tenés permiso.";
const NO_ADVANCE = "No pudimos avanzar al paso siguiente. Probá de nuevo.";

async function advance(tenantId: string): Promise<boolean> {
	const supabase = await createServerSupabase();
	const { error } = await supabase.rpc("set_onboarding_step", {
		p_tenant: tenantId,
		p_step: "acceso",
	});
	if (error) console.error("set_onboarding_step falló", tenantId, error);
	return !error;
}

export async function uploadLogoStep(
	slug: string,
	formData: FormData,
): Promise<{ ok: true } | { ok: false; message: string }> {
	const g = await gateForStep(slug, "logo");
	if (!g) return { ok: false, message: NOT_ALLOWED };
	let done = false;
	try {
		const saved = await saveLogo(slug, formData);
		if (!saved.ok) return saved;
		if (!(await advance(g.access.id)))
			return { ok: false, message: NO_ADVANCE };
		done = true;
	} catch (error) {
		console.error("uploadLogoStep falló", error);
		return { ok: false, message: "No se pudo guardar. Probá de nuevo." };
	}
	// Fuera del try: redirect() tira y un catch lo taparía.
	if (done) redirect(stepPath(slug, "acceso"));
	return { ok: true };
}

export async function skipLogoStep(slug: string): Promise<void> {
	const g = await gateForStep(slug, "logo");
	if (!g) redirect("/empezar");
	if (!(await advance(g.access.id))) throw new Error(NO_ADVANCE);
	redirect(stepPath(slug, "acceso"));
}
