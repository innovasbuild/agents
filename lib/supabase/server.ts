import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

export async function createServerSupabase() {
	const cookieStore = await cookies();

	return createServerClient(
		process.env.NEXT_PUBLIC_SUPABASE_URL!,
		process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
		{
			cookies: {
				getAll() {
					return cookieStore.getAll();
				},
				setAll(cookiesToSet) {
					try {
						for (const { name, value, options } of cookiesToSet) {
							cookieStore.set(name, value, options);
						}
					} catch {
						// setAll llamado desde un Server Component sin permiso de escritura.
						// El refresco de sesión no está implementado en este spike: sin
						// middleware, el access token expira (default 1h de Supabase) y el
						// usuario tiene que volver a loguearse. Deuda para Etapa 1.
					}
				},
			},
		},
	);
}
