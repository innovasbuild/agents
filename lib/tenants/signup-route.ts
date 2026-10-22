// A dónde va quien entra con sesión y todavía no tiene empresa (spec 27 §4).
// La decisión la toma la base (signup_route); acá solo se traduce a una ruta.
export type SignupRoute = "chat" | "empezar" | "dominio_tomado" | "sin_acceso";

const ROUTES: readonly SignupRoute[] = [
	"chat",
	"empezar",
	"dominio_tomado",
	"sin_acceso",
];

export async function signupRoute(supabase: {
	rpc(fn: "signup_route"): PromiseLike<{ data: unknown; error: unknown }>;
}): Promise<SignupRoute> {
	try {
		const { data, error } = await supabase.rpc("signup_route");
		if (error) return "sin_acceso";
		return ROUTES.find((route) => route === data) ?? "sin_acceso";
	} catch {
		return "sin_acceso";
	}
}

export function signupRoutePath(
	route: SignupRoute,
	firstSlug: string | null,
): string {
	switch (route) {
		case "chat":
			return firstSlug ? `/${firstSlug}` : "/sin-acceso";
		case "empezar":
			return "/empezar/empresa";
		case "dominio_tomado":
			return "/empezar/dominio-tomado";
		default:
			return "/sin-acceso";
	}
}
