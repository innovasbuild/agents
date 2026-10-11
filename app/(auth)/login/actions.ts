"use server";

import { headers } from "next/headers";
import { z } from "zod";
import { completeLogin as runCompleteLogin } from "@/lib/auth/complete-login";
import { LOGIN_INCOMPLETE_ERROR } from "@/lib/auth/email-code";
import { safeNextPath } from "@/lib/auth/next-path";
import { emailDomain } from "@/lib/invitations/domain";
import { createAdminClient } from "@/lib/supabase/admin";
import { createServerSupabase } from "@/lib/supabase/server";
import { originFrom } from "@/lib/tenants/origin";

const emailSchema = z.email().max(254);

// Solo se llama después de un código válido: la falla no es del código y el
// navegador cierra la sesión al recibirla.
const NO_TERMINO = { ok: false as const, message: LOGIN_INCOMPLETE_ERROR };

/**
 * ¿Puede este mail crear cuenta al pedir el link? Solo si su dominio está
 * abierto en alguna empresa activa (spec ingreso por dominio, D9). La
 * pantalla nunca muestra el resultado: el mensaje es el mismo siempre.
 * Cualquier error responde false, que es el comportamiento de antes.
 */
export async function canSignUpByDomain(email: string): Promise<boolean> {
	if (typeof email !== "string") return false;
	const parsed = emailSchema.safeParse(email.trim());
	if (!parsed.success) return false;
	const domain = emailDomain(parsed.data);
	if (!domain) return false;

	try {
		const { data, error } = await createAdminClient()
			.from("tenants")
			.select("allowed_domains")
			.eq("active", true)
			.eq("self_signup_by_domain", true);
		if (error) return false;

		return (data ?? []).some((row) =>
			(row.allowed_domains as string[]).some(
				(allowed) => allowed.trim().toLowerCase() === domain,
			),
		);
	} catch {
		return false;
	}
}

/**
 * Lo que sigue a verificar el código en el navegador (spec 21.4 §5.1): con la
 * sesión ya en cookies, corre el mismo tramo que /auth/callback (membresías y
 * compuerta de método) y devuelve adónde ir: `next` ya saneado, o la landing
 * si la compuerta rechazó (la sesión ya quedó cerrada). Sin sesión o con una
 * falla responde que no se pudo terminar, distinto del mensaje del código.
 * No usa redirect(): en Next 16 eso rechaza la promesa de la acción en el
 * navegador y el éxito se confundía con una falla. Navega el cliente.
 */
export async function completeLogin(
	next: string | null,
): Promise<{ ok: true; target: string } | { ok: false; message: string }> {
	try {
		const supabase = await createServerSupabase();
		const { data, error } = await supabase.auth.getUser();
		if (error || !data.user) return NO_TERMINO;

		const gate = await runCompleteLogin(supabase);
		const target = gate.ok
			? safeNextPath(
					typeof next === "string" ? next : null,
					originFrom(await headers()),
				)
			: gate.landing;
		return { ok: true, target };
	} catch (error) {
		console.error("completeLogin falló:", error);
		return NO_TERMINO;
	}
}
