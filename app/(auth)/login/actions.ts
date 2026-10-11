"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { completeLogin } from "@/lib/auth/complete-login";
import { safeNextPath } from "@/lib/auth/next-path";
import { emailDomain } from "@/lib/invitations/domain";
import { createAdminClient } from "@/lib/supabase/admin";
import { createServerSupabase } from "@/lib/supabase/server";
import { originFrom } from "@/lib/tenants/origin";

const emailSchema = z.email().max(254);

const CODIGO_INVALIDO = {
	ok: false as const,
	message: "El código no es correcto o ya venció. Pedí otro.",
};

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
 * Entra con el código de 6 dígitos del mail (spec 21.4 §5). Un solo mensaje
 * para código mal escrito, equivocado, vencido o de otro correo: la pantalla
 * no confirma quién tiene cuenta. Con éxito no devuelve: redirige.
 */
export async function verifyEmailCode(
	email: string,
	code: string,
	next: string | null,
): Promise<{ ok: false; message: string }> {
	if (typeof email !== "string" || typeof code !== "string") {
		return CODIGO_INVALIDO;
	}
	const parsedEmail = emailSchema.safeParse(email.trim().toLowerCase());
	const token = code.replace(/\s+/g, "");
	if (!parsedEmail.success || !/^\d{6}$/.test(token)) return CODIGO_INVALIDO;

	let target: string;
	try {
		const supabase = await createServerSupabase();
		const { data, error } = await supabase.auth.verifyOtp({
			email: parsedEmail.data,
			token,
			type: "email",
		});
		if (error || !data.session) return CODIGO_INVALIDO;

		// El mismo tramo que /auth/callback: membresías y compuerta de método.
		const gate = await completeLogin(supabase);
		target = gate.ok
			? safeNextPath(
					typeof next === "string" ? next : null,
					originFrom(await headers()),
				)
			: gate.landing;
	} catch (error) {
		console.error("verifyEmailCode falló:", error);
		return CODIGO_INVALIDO;
	}
	// Fuera del try: redirect() tira para cortar la acción.
	redirect(target);
}
