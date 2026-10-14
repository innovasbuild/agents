import { createServerClient } from "@supabase/ssr";
import { type NextRequest, NextResponse } from "next/server";
import { routeTenantPath } from "@/lib/tenants/host-routing";
import { resolveHostBinding } from "@/lib/tenants/host-store";

/**
 * Dos trabajos en cada navegación server (spec etapa 21.6):
 *
 * 1. El host decide la empresa. En el dominio propio de una empresa
 *    (ai.okeefe.com.ar) las URLs son limpias, sin el slug: el proxy reescribe
 *    /chat a /okeefe/chat, y una URL con slug redirige a la limpia. El host
 *    raíz sigue como siempre. Uno que no es de nadie da 404.
 * 2. Refresca el access token de Supabase. Cierra la deuda de la Etapa 0: sin
 *    esto el token vence a la hora y el usuario tiene que volver a loguearse.
 *
 * Quedan afuera las rutas de eve y de discovery, que se autentican por bearer
 * o son públicas. El endpoint MCP del brain del host raíz (/brain/<slug>/mcp)
 * pasa por acá solo para salir enseguida, sin tocar Supabase.
 */
const ROOT_BRAIN_MCP = /^\/brain\/[^/]+\/mcp$/;

export async function proxy(request: NextRequest) {
	const { pathname } = request.nextUrl;

	let binding: Awaited<ReturnType<typeof resolveHostBinding>>;
	try {
		binding = await resolveHostBinding(request.headers);
	} catch (error) {
		// Un error de lectura no es "no existe": 503, y nunca se cachea.
		console.error("proxy: no pude resolver el dominio", error);
		return new NextResponse("No pude resolver el dominio. Probá de nuevo.", {
			status: 503,
		});
	}

	if (binding.kind === "unknown") {
		return new NextResponse("No encontrado", { status: 404 });
	}
	if (binding.kind === "root" && ROOT_BRAIN_MCP.test(pathname)) {
		return NextResponse.next({ request });
	}

	let rewriteTo: URL | null = null;
	if (binding.kind === "tenant") {
		const routing = routeTenantPath(pathname, binding.slug);
		if (routing.action === "notFound") {
			return new NextResponse("No encontrado", { status: 404 });
		}
		if (routing.action === "redirect") {
			const url = request.nextUrl.clone();
			url.pathname = routing.to;
			return NextResponse.redirect(url, 308);
		}
		if (routing.action === "rewrite") {
			rewriteTo = request.nextUrl.clone();
			rewriteTo.pathname = routing.to;
		}
	}

	const respond = () =>
		rewriteTo
			? NextResponse.rewrite(rewriteTo, { request })
			: NextResponse.next({ request });
	let response = respond();

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
					response = respond();
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
		"/((?!_next/static|_next/image|favicon.ico|eve/|\\.well-known/|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
	],
};
