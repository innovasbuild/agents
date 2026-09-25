import { createServerClient } from "@supabase/ssr";
import { type NextRequest, NextResponse } from "next/server";

/**
 * Refresca el access token de Supabase en cada navegación server. Cierra la
 * deuda de la Etapa 0: sin esto el token vence a la hora y el usuario tiene
 * que volver a loguearse. Las rutas de eve, del brain por MCP y de discovery
 * quedan afuera: se autentican por bearer o son públicas.
 */
export async function proxy(request: NextRequest) {
	let response = NextResponse.next({ request });

	const supabase = createServerClient(
		process.env.NEXT_PUBLIC_SUPABASE_URL!,
		process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
		{
			cookies: {
				getAll() {
					return request.cookies.getAll();
				},
				setAll(cookiesToSet) {
					for (const { name, value } of cookiesToSet) {
						request.cookies.set(name, value);
					}
					response = NextResponse.next({ request });
					for (const { name, value, options } of cookiesToSet) {
						response.cookies.set(name, value, options);
					}
				},
			},
		},
	);

	await supabase.auth.getUser();

	return response;
}

export const config = {
	matcher: [
		"/((?!_next/static|_next/image|favicon.ico|eve/|brain/|\\.well-known/|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
	],
};
