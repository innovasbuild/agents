// tests/plataforma/detail-page.test.ts
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

type Result = { data: unknown; error: unknown };
const state = {
	admin: true as boolean,
	tenant: {
		id: "t1",
		slug: "acme",
		display_name: "Acme",
		allowed_domains: [],
		self_signup_by_domain: false,
		allowed_models: ["m"],
		default_model: "m",
		auth_methods: ["email"],
		brand: {},
		active: true,
	} as Record<string, unknown> | null,
	memberships: [] as unknown[],
	agents: [] as unknown[],
	connections: [] as unknown[],
	domains: [] as unknown[],
	failing: null as string | null,
};

function query(result: () => Result) {
	const q = {
		select: () => q,
		eq: () => q,
		order: () => q,
		maybeSingle: async () => result(),
		returns: () => q,
		// biome-ignore lint/suspicious/noThenProperty: imita el builder de supabase-js
		then: (resolve: (value: Result) => unknown) =>
			Promise.resolve(result()).then(resolve),
	};
	return q;
}

vi.mock("@/lib/tenants/platform", () => ({
	platformOwnerSlug: () => "innovas",
	requirePlatformAdmin: async () =>
		state.admin
			? {
					userId: "u1",
					supabase: {
						rpc: async () => ({ data: [], error: null }),
						from: (table: string) =>
							query(() => ({
								data:
									table === "tenants"
										? state.tenant
										: table === "memberships"
											? state.memberships
											: table === "tenant_agents"
												? state.agents
												: table === "tenant_domains"
													? state.domains
													: state.connections,
								error:
									table === state.failing
										? { code: "XX000", message: "roto" }
										: null,
							})),
					},
				}
			: null,
}));
vi.mock("@/lib/outreach/canon", () => ({
	brainForTenant: async () => null,
	loadIcpLevels: async () => ({ ok: false, reason: "brain_caido", errors: [] }),
	loadMarco: async () => ({ ok: false, reason: "brain_caido", errors: [] }),
}));
vi.mock("@/lib/tenants/people", () => ({ loadPeople: async () => new Map() }));
vi.mock("next/headers", () => ({
	headers: async () => new Headers({ origin: "https://app.test" }),
}));
vi.mock("next/navigation", () => ({
	notFound: () => {
		throw new Error("NEXT_NOT_FOUND");
	},
	useRouter: () => ({ refresh: () => {} }),
}));
vi.mock("@/app/plataforma/[slug]/tenant-form", () => ({
	TenantForm: () => null,
}));
vi.mock("@/app/plataforma/[slug]/domain-actions", () => ({
	addTenantDomain: async () => ({ ok: true, message: "" }),
	verifyTenantDomain: async () => ({ ok: true, message: "" }),
	makeTenantDomainPrimary: async () => ({ ok: true, message: "" }),
	removeTenantDomain: async () => ({ ok: true, message: "" }),
}));
vi.mock("@/app/plataforma/[slug]/console-actions", () => ({
	setAgent: async () => ({ ok: true }),
	createBrain: async () => ({ ok: true }),
	bindConnection: async () => ({ ok: true }),
	setConnectionEnabled: async () => ({ ok: true }),
	removeConnection: async () => ({ ok: true }),
	verifyConnection: async () => ({ ok: true }),
}));

const { default: TenantDetailPage } = await import(
	"@/app/plataforma/[slug]/page"
);

const render = async () =>
	renderToStaticMarkup(
		await TenantDetailPage({
			params: Promise.resolve({ slug: "acme" }),
			searchParams: Promise.resolve({}),
		}),
	);

describe("detalle de la empresa", () => {
	beforeEach(() => {
		state.admin = true;
		state.memberships = [];
		state.agents = [
			{ agent: "outreach", enabled: true, config: { brain: "read_write" } },
		];
		state.connections = [];
		state.domains = [];
		state.failing = null;
		vi.unstubAllEnvs();
	});

	describe("sección Dominio", () => {
		const row = (over: Record<string, unknown>) => ({
			id: "d1",
			tenant_id: "t1",
			hostname: "ai.acme.com",
			is_primary: false,
			status: "verifying",
			last_error: null,
			verified_at: null,
			created_at: "2026-10-14T00:00:00Z",
			...over,
		});

		it("sin dominios dice que sigue por la dirección de la plataforma", async () => {
			const html = await render();
			expect(html).toContain("Dominio");
			expect(html).toContain("Todavía no tiene un dominio propio");
			expect(html).toContain("Agregar dominio");
		});

		it("lista cada dominio con su estado y marca el principal", async () => {
			state.domains = [
				row({
					id: "d1",
					hostname: "ai.acme.com",
					status: "active",
					is_primary: true,
				}),
				row({
					id: "d2",
					hostname: "viejo.acme.com",
					status: "failed",
					last_error: "Ese dominio ya está en otro proyecto de Vercel.",
				}),
			];
			const html = await render();
			expect(html).toContain("ai.acme.com");
			expect(html).toContain("Activo");
			expect(html).toContain("Principal");
			expect(html).toContain("Con error");
			expect(html).toContain("Ese dominio ya está en otro proyecto de Vercel.");
			expect(html).toContain("Verificar ahora");
			expect(html).toContain("Quitar");
		});

		it("un dominio activo no ofrece verificar y el principal no ofrece hacerlo principal", async () => {
			state.domains = [row({ status: "active", is_primary: true })];
			const html = await render();
			expect(html).not.toContain("Verificar ahora");
			expect(html).not.toContain("Hacer principal");
		});

		it("un activo que no es principal ofrece hacerlo principal", async () => {
			state.domains = [row({ status: "active", is_primary: false })];
			expect(await render()).toContain("Hacer principal");
		});

		it("avisa si faltan las variables de Vercel y de Supabase", async () => {
			vi.stubEnv("VERCEL_API_TOKEN", "");
			vi.stubEnv("SUPABASE_ACCESS_TOKEN", "");
			const html = await render();
			expect(html).toContain("VERCEL_API_TOKEN");
			expect(html).toContain("SUPABASE_ACCESS_TOKEN");
		});

		it("si no se pueden leer los dominios lo dice sin romper la página", async () => {
			const error = vi.spyOn(console, "error").mockImplementation(() => {});
			state.failing = "tenant_domains";
			const html = await render();
			expect(html).toContain("No se pudieron leer los dominios");
			expect(html).toContain("Conectores");
			error.mockRestore();
		});
	});

	it("sin plataforma da 404", async () => {
		state.admin = false;
		await expect(render()).rejects.toThrow("NEXT_NOT_FOUND");
	});

	it("muestra qué falta y las tres secciones", async () => {
		const html = await render();
		expect(html).toContain("Qué falta");
		expect(html).toContain("sin brain");
		expect(html).toContain("faltan conectores");
		expect(html).toContain("Agentes");
		expect(html).toContain("Crear brain");
		expect(html).toContain("Asociar conector");
	});

	it("con todo listo lo dice", async () => {
		state.connections = [
			{
				id: "c1",
				capability: "brain",
				provider: "wiki",
				connector_uid: null,
				config: { categories: ["empresa"] },
				enabled: true,
				verified_at: null,
				verified_name: null,
				created_at: "2026-10-10T00:00:00Z",
			},
			{
				id: "c2",
				capability: "crm",
				provider: "hubspot",
				connector_uid: null,
				config: {},
				enabled: true,
				verified_at: null,
				verified_name: null,
				created_at: "2026-10-10T00:00:00Z",
			},
			{
				id: "c3",
				capability: "leads",
				provider: "coldiq",
				connector_uid: "acme-coldiq",
				config: {},
				enabled: true,
				verified_at: "2026-10-10T00:00:00Z",
				verified_name: "Acme ColdIQ",
				created_at: "2026-10-10T00:00:00Z",
			},
			{
				id: "c4",
				capability: "mail",
				provider: "gmail",
				connector_uid: null,
				config: {},
				enabled: true,
				verified_at: null,
				verified_name: null,
				created_at: "2026-10-10T00:00:00Z",
			},
		];
		const html = await render();
		expect(html).toContain("Lista para trabajar");
		expect(html).not.toContain("Crear brain");
		expect(html).toContain("Acme ColdIQ");
	});

	const brainOn = {
		id: "c1",
		capability: "brain",
		provider: "wiki",
		connector_uid: null,
		config: { categories: ["empresa"] },
		enabled: true,
		verified_at: null,
		verified_name: null,
		created_at: "2026-10-10T00:00:00Z",
	};

	it("brain caído con outreach habilitado: avisa que no pudo leerlo", async () => {
		state.connections = [brainOn];
		expect(await render()).toContain("No pude leer el brain");
	});

	it("brain caído pero sin agente que necesite el canon: no avisa", async () => {
		state.agents = [];
		state.connections = [brainOn];
		expect(await render()).not.toContain("No pude leer el brain");
	});

	it("un brain deshabilitado no ofrece crearlo de nuevo", async () => {
		state.connections = [
			{
				id: "c1",
				capability: "brain",
				provider: "wiki",
				connector_uid: null,
				config: { categories: ["empresa"] },
				enabled: false,
				verified_at: null,
				verified_name: null,
				created_at: "2026-10-10T00:00:00Z",
			},
		];
		const html = await render();
		expect(html).toContain("Deshabilitado");
		expect(html).not.toContain("Crear brain");
	});

	it.each(["tenant_agents", "tenant_connections"])(
		"si falla leer %s, dice que no pudo leer el estado y no inventa faltantes",
		async (table) => {
			const log = vi.spyOn(console, "error").mockImplementation(() => {});
			state.failing = table;
			const html = await render();
			expect(html).toContain("No pude leer el estado");
			expect(html).not.toContain("sin brain");
			expect(html).not.toContain("Lista para trabajar");
			expect(log).toHaveBeenCalled();
			log.mockRestore();
		},
	);
});
