// Value: protects=la ruta de datos del grafo responde 404 sin contexto ok, sirve el payload de buildGraphPayload con
//   cache-control private no-store, relanza los errores del proveedor y, con el proveedor real envuelto con permisos,
//   no deja salir nada de una carpeta oculta (nodos, aristas, categorias, tags ni titulos).
// fails_when=el handler cachea compartido, traga un error como 404, deja de pasar por ctx.provider o una carpeta
//   oculta se cuela en el payload.
// why_new=la ruta de datos del mapa es nueva y es la unica via por la que sale el brain completo; seam=none
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GraphPayload } from "@/lib/brain/core/graph";

type Row = Record<string, unknown>;

const state = vi.hoisted(() => ({
	// false: el contexto sale de `ctx`; true: lo arma el adaptador real.
	real: false,
	ctx: null as unknown,
	user: null as { id: string } | null,
	pages: [] as Row[],
	links: [] as Row[],
	rules: [] as Row[],
	bindingProvider: "wiki",
	adminError: null as Error | null,
}));

vi.mock("@/lib/brain/adapters/editor", async (importOriginal) => {
	const actual =
		await importOriginal<typeof import("@/lib/brain/adapters/editor")>();
	return {
		...actual,
		loadEditorContext: vi.fn(async (tenant: string) =>
			state.real
				? actual.loadEditorContext(tenant)
				: (state.ctx as Awaited<ReturnType<typeof actual.loadEditorContext>>),
		),
	};
});

// Cliente de sesión: lo único que usa resolveTenantAccess.
vi.mock("@/lib/supabase/server", () => ({
	createServerSupabase: async () => ({
		auth: {
			getClaims: async () => ({
				data: state.user ? { claims: { sub: state.user.id } } : null,
				error: null,
			}),
		},
		rpc: async () => ({ data: true, error: null }),
		from: (table: string) => {
			const filters: Record<string, unknown> = {};
			const chain = {
				select: () => chain,
				eq: (column: string, value: unknown) => {
					filters[column] = value;
					return chain;
				},
				maybeSingle: async () => {
					const rows =
						table === "tenants"
							? [
									{
										id: "tenant-a",
										slug: "acme",
										active: true,
										display_name: "acme",
										default_model: "anthropic/claude-sonnet-5",
										allowed_models: ["anthropic/claude-sonnet-5"],
										brand: {},
									},
								]
							: [
									{
										tenant_id: "tenant-a",
										user_id: "user-a",
										role: "tenant_member",
									},
								];
					const hit = rows.find((row) =>
						Object.entries(filters).every(
							([key, value]) => (row as Row)[key] === value,
						),
					);
					return { data: hit ?? null };
				},
			};
			return chain;
		},
	}),
}));

// Cliente admin (service role): lee páginas, links por keyset y reglas.
vi.mock("@/lib/supabase/admin", () => ({
	createAdminClient: () => {
		if (state.adminError) throw state.adminError;
		return {
			from: (table: string) => {
				const filters: Record<string, unknown> = {};
				const chain = {
					select: () => chain,
					eq: (column: string, value: unknown) => {
						filters[column] = value;
						return chain;
					},
					order: () => chain,
					range: async (from: number) => ({
						data: table === "brain_pages" && from === 0 ? state.pages : [],
						error: null,
					}),
					// biome-ignore lint/suspicious/noThenProperty: la cadena de PostgREST es esperable
					then: (resolve: (value: unknown) => void) => {
						resolve({
							data: table === "brain_access_rules" ? state.rules : [],
							error: null,
						});
					},
				};
				return chain;
			},
			rpc: (_name: string, args: { p_after: string | null }) => ({
				order: async () => ({
					data: state.links.filter(
						(row) =>
							args.p_after === null || (row.slug as string) > args.p_after,
					),
					error: null,
				}),
			}),
		};
	},
}));

vi.mock("@/lib/connectors/bindings", () => ({
	loadTenantBindings: vi.fn(async (tenantId: string) => [
		{
			id: `binding-${tenantId}`,
			tenantId,
			capability: "brain",
			provider: state.bindingProvider,
			connectorUid: null,
			config: {
				categories: ["comercial", "talento"],
				requiredFrontmatter: [],
				search: "fts",
			},
		},
	]),
}));

import { GET } from "@/app/[tenant]/brain/mapa/datos/route";

function call() {
	return GET(new Request("http://localhost/acme/brain/mapa/datos"), {
		params: Promise.resolve({ tenant: "acme" }),
	});
}

function pageRow(slug: string, title: string, tags: string[] = []): Row {
	return {
		slug,
		title,
		category: slug.split("/")[0],
		status: "activo",
		tags,
		revision: 1,
		updated_at: "2026-10-01T00:00:00Z",
	};
}

function linkRow(slug: string, ...targets: string[]): Row {
	return {
		slug,
		links: targets.map((target) => ({ target, anchor: null, alias: null })),
	};
}

beforeEach(() => {
	state.real = false;
	state.ctx = null;
	state.user = { id: "user-a" };
	state.pages = [];
	state.links = [];
	state.rules = [];
	state.bindingProvider = "wiki";
	state.adminError = null;
	delete process.env.PLATFORM_OWNER_TENANT_SLUG;
});

describe("GET /[tenant]/brain/mapa/datos", () => {
	it("404 sin contexto", async () => {
		expect((await call()).status).toBe(404);
	});

	it.each(["no-brain", "external"])(
		"404 si el contexto es %s",
		async (kind) => {
			const listMeta = vi.fn();
			state.ctx = { kind, provider: { listMeta, listLinks: vi.fn() } };
			expect((await call()).status).toBe(404);
			expect(listMeta).not.toHaveBeenCalled();
		},
	);

	it("200 con el payload y cache-control private, no-store", async () => {
		const provider = {
			listMeta: vi.fn(async () => [
				{
					slug: "comercial/icp",
					title: "ICP",
					category: "comercial",
					status: "activo",
					tags: ["ventas"],
					revision: 1,
					updatedAt: "2026-10-01T00:00:00Z",
				},
				{
					slug: "comercial/oferta",
					title: "Oferta",
					category: "comercial",
					status: "activo",
					tags: [],
					revision: 1,
					updatedAt: "2026-10-02T00:00:00Z",
				},
			]),
			listLinks: vi.fn(async () => [
				{
					slug: "comercial/icp",
					links: [{ target: "comercial/oferta", anchor: null, alias: null }],
				},
			]),
		};
		state.ctx = { kind: "ok", provider };
		const res = await call();
		expect(res.status).toBe(200);
		expect(res.headers.get("cache-control")).toBe("private, no-store");
		const payload = (await res.json()) as GraphPayload;
		expect(payload.nodes.map((n) => n[0])).toEqual([
			"comercial/icp",
			"comercial/oferta",
		]);
		expect(payload.edges).toEqual([[0, 1]]);
		expect(payload.total).toBe(2);
		expect(payload.truncated).toBe(false);
		// Fuera de un request React, cache() no deduplica: alcanza con que pase por acá.
		expect(provider.listMeta).toHaveBeenCalled();
		expect(provider.listLinks).toHaveBeenCalled();
	});

	it("relanza los errores del proveedor en vez de tragarlos como 404", async () => {
		state.ctx = {
			kind: "ok",
			provider: {
				listMeta: vi.fn(async () => {
					throw new Error("proveedor caído");
				}),
				listLinks: vi.fn(async () => []),
			},
		};
		await expect(call()).rejects.toThrow("proveedor caído");
	});
});

describe("GET /[tenant]/brain/mapa/datos · proveedor real con permisos", () => {
	beforeEach(() => {
		state.real = true;
		// Dos carpetas: comercial es visible y talento se esconde a los miembros.
		state.pages = [
			pageRow("comercial/icp", "ICP", ["ventas"]),
			pageRow("comercial/oferta", "Oferta"),
			pageRow("talento/organigrama", "Organigrama reservado", ["rrhh-secreto"]),
			pageRow("talento/salarios", "Escala salarial", ["rrhh-secreto"]),
		];
		state.links = [
			// icp apunta a oferta (visible) y a una página de talento (oculta).
			linkRow("comercial/icp", "comercial/oferta", "talento/organigrama"),
			// Los links de una página oculta no se ven.
			linkRow("talento/organigrama", "comercial/icp", "talento/salarios"),
			linkRow("talento/salarios", "comercial/oferta"),
		];
		state.rules = [
			{
				tenant_id: "tenant-a",
				path: "talento",
				principal: "members",
				user_id: null,
				level: "ninguno",
			},
		];
	});

	it("quien no ve talento no recibe sus páginas, aristas, categoría ni tags", async () => {
		const res = await call();
		expect(res.status).toBe(200);
		const text = await res.text();
		const payload = JSON.parse(text) as GraphPayload;

		expect(payload.nodes.map((n) => n[0])).toEqual([
			"comercial/icp",
			"comercial/oferta",
		]);
		expect(payload.categories).toEqual(["comercial"]);
		expect(payload.tags).toEqual(["ventas"]);
		expect(payload.edges).toEqual([[0, 1]]);
		expect(payload.total).toBe(2);

		// Nada de la carpeta oculta en el texto: ni títulos, ni tags, ni la página
		// que nadie visible enlaza.
		for (const hidden of [
			"Organigrama reservado",
			"Escala salarial",
			"rrhh-secreto",
			"talento/salarios",
		])
			expect(text).not.toContain(hidden);
		// Fuera de `broken` (que repite lo que escribió la propia página visible)
		// no aparece ni la carpeta.
		const { broken: _broken, ...rest } = payload;
		expect(JSON.stringify(rest)).not.toContain("talento");
	});

	it("el link de una página visible hacia la oculta queda roto, no es una arista", async () => {
		const payload = (await (await call()).json()) as GraphPayload;
		expect(payload.edges).toEqual([[0, 1]]);
		// comercial/icp es el nodo 0 y es la única fuente del destino roto.
		expect(payload.broken).toEqual([["talento/organigrama", [0]]]);
	});
});
