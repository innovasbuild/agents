"use server";

import { redirect } from "next/navigation";
import { closeLocalSession } from "@/lib/auth/close-session";
import { createServerSupabase } from "@/lib/supabase/server";

const SLUG = /^[a-z0-9-]{1,63}$/;

/**
 * Cierra la sesión de este dispositivo y vuelve al login de la empresa. Se
 * cierra solo la local: las abiertas en otros dispositivos siguen. En el
 * dominio propio, el proxy convierte /login/<slug> en /login.
 */
export async function signOut(slug: string): Promise<never> {
	try {
		await closeLocalSession(await createServerSupabase());
	} catch (error) {
		console.error("signOut falló:", error);
	}
	redirect(
		typeof slug === "string" && SLUG.test(slug) ? `/login/${slug}` : "/login",
	);
}
