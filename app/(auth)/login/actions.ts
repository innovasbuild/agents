"use server";

import { z } from "zod";
import { emailDomain } from "@/lib/invitations/domain";
import { createAdminClient } from "@/lib/supabase/admin";

const emailSchema = z.email().max(254);

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
