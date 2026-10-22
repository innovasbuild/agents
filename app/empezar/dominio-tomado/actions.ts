"use server";

import { redirect } from "next/navigation";
import { closeLocalSession } from "@/lib/auth/close-session";
import { createServerSupabase } from "@/lib/supabase/server";

/** "Entrar con otro correo": cierra la sesión de este dispositivo y vuelve a /empezar. */
export async function signOutToEmpezar(): Promise<never> {
	try {
		await closeLocalSession(await createServerSupabase());
	} catch (error) {
		console.error("signOutToEmpezar falló:", error);
	}
	redirect("/empezar");
}
