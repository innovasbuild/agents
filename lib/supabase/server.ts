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
						// setAll llamado desde un Server Component sin permiso de
						// escritura. El refresco lo hace middleware.ts, así que
						// perder esta escritura no desloguea a nadie.
					}
				},
			},
		},
	);
}
