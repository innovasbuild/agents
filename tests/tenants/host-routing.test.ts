import { describe, expect, it } from "vitest";
import { routeTenantPath } from "@/lib/tenants/host-routing";

const route = (pathname: string) => routeTenantPath(pathname, "okeefe");

describe("routeTenantPath (host de la empresa okeefe)", () => {
	describe("entradas limpias: rewrite a la ruta interna", () => {
		it.each([
			["/", "/okeefe"],
			["/chat", "/okeefe/chat"],
			["/conectar", "/okeefe/conectar"],
			["/settings/usuarios", "/okeefe/settings/usuarios"],
			["/brain", "/okeefe/brain"],
			["/brain/mapa", "/okeefe/brain/mapa"],
			["/brain/p/ventas/propuesta", "/okeefe/brain/p/ventas/propuesta"],
			["/brain/p/mcp", "/okeefe/brain/p/mcp"],
			["/chat/", "/okeefe/chat/"],
		])("%s", (pathname, to) => {
			expect(route(pathname)).toEqual({ action: "rewrite", to });
		});

		it("/login lleva al login de la empresa", () => {
			expect(route("/login")).toEqual({
				action: "rewrite",
				to: "/login/okeefe",
			});
		});

		it("/brain/mcp es el endpoint MCP del brain de la empresa", () => {
			expect(route("/brain/mcp")).toEqual({
				action: "rewrite",
				to: "/brain/okeefe/mcp",
			});
		});
	});

	describe("URLs con slug: redirigen a la forma limpia", () => {
		it.each([
			["/okeefe", "/"],
			["/okeefe/", "/"],
			["/okeefe/chat", "/chat"],
			["/okeefe/brain/mapa", "/brain/mapa"],
			["/okeefe/settings/usuarios", "/settings/usuarios"],
			["/login/okeefe", "/login"],
		])("%s", (pathname, to) => {
			expect(route(pathname)).toEqual({ action: "redirect", to });
		});

		it("un slug que solo empieza igual no redirige", () => {
			expect(route("/okeefe-otro/chat")).toEqual({
				action: "rewrite",
				to: "/okeefe/okeefe-otro/chat",
			});
		});
	});

	describe("rutas que no son de la empresa", () => {
		it.each([
			"/plataforma",
			"/plataforma/okeefe",
			"/oauth/consent",
			"/brain/okeefe/mcp",
			"/login/lagomarsino",
		])("%s da 404", (pathname) => {
			expect(route(pathname)).toEqual({ action: "notFound" });
		});

		it("otra empresa no se alcanza: /lagomarsino/chat se lee como una ruta de okeefe", () => {
			expect(route("/lagomarsino/chat")).toEqual({
				action: "rewrite",
				to: "/okeefe/lagomarsino/chat",
			});
		});
	});

	describe("rutas sin empresa que pasan tal cual", () => {
		it.each([
			"/auth/callback",
			"/auth/confirmar",
			"/sin-acceso",
			"/api/invitations",
			"/eve/outreach/v1/mcp",
			"/.well-known/oauth-protected-resource/brain/mcp",
			"/_next/static/chunk.js",
		])("%s", (pathname) => {
			expect(route(pathname)).toEqual({ action: "next" });
		});
	});
});
