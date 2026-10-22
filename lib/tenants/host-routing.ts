// Qué hace el proxy con una ruta pedida por el dominio de una empresa (spec
// 21.6 §4.3). Puro y sin Next: la tabla entera se prueba fila por fila.
//
// La ruta interna no cambia (app/[tenant]/...): lo visible es limpio, sin el
// slug, y el proxy la reescribe. Si llega una URL con slug (los href de la
// app todavía los arman así) se redirige a la forma limpia.

export type TenantRouting =
	| { action: "rewrite"; to: string }
	| { action: "redirect"; to: string }
	| { action: "notFound" }
	| { action: "next" };

// Primeros segmentos que nunca son de la empresa y se sirven tal cual.
const PASSTHROUGH = new Set([
	"auth",
	"sin-acceso",
	"api",
	"eve",
	".well-known",
	"_next",
]);

// Rutas de la plataforma: en el dominio de una empresa no existen.
const PLATFORM_ONLY = new Set(["plataforma", "oauth", "empezar"]);

export function routeTenantPath(pathname: string, slug: string): TenantRouting {
	const [, first = "", ...rest] = pathname.split("/");

	// La forma con slug redirige a la limpia.
	if (first === "login" && rest[0] === slug && rest.length === 1) {
		return { action: "redirect", to: "/login" };
	}
	if (first === slug) {
		const tail = rest.join("/");
		return { action: "redirect", to: tail ? `/${tail}` : "/" };
	}

	if (PLATFORM_ONLY.has(first)) return { action: "notFound" };
	// El endpoint MCP del brain en un dominio de empresa es /brain/mcp (H14): la
	// forma con slug solo existe en el host raíz.
	if (first === "brain" && rest[0] === slug && rest[1] === "mcp") {
		return { action: "notFound" };
	}
	// El login de otra empresa no se sirve desde este dominio (H3).
	if (first === "login" && rest.length > 0) return { action: "notFound" };

	if (pathname === "/") return { action: "rewrite", to: `/${slug}` };
	if (pathname === "/login") {
		return { action: "rewrite", to: `/login/${slug}` };
	}
	if (pathname === "/brain/mcp") {
		return { action: "rewrite", to: `/brain/${slug}/mcp` };
	}
	if (PASSTHROUGH.has(first)) return { action: "next" };

	return { action: "rewrite", to: `/${slug}${pathname}` };
}
