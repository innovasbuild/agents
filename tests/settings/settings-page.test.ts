import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

type Result = { data: unknown; error: unknown };
const state = {
	role: "tenant_admin" as string,
	tables: {} as Record<string, Result>,
	selects: {} as Record<string, string>,
};

function query(table: string) {
	const result = (): Result => state.tables[table] ?? { data: [], error: null };
	const q = {
		select: (columns: string) => {
			state.selects[table] = columns;
			return q;
		},
		eq: () => q,
		order: () => q,
		maybeSingle: async () => result(),
		// biome-ignore lint/suspicious/noThenProperty: imita el builder de supabase-js
		then: (resolve: (value: Result) => unknown) =>
			Promise.resolve(result()).then(resolve),
	};
	return q;
}

vi.mock("@/lib/tenants/resolve", () => ({
	resolveTenantAccess: async () => ({
		id: "t1",
		slug: "acme",
		displayName: "Acme",
		role: state.role,
		userId: "me",
		defaultModel: "m",
		allowedModels: ["m"],
		brand: {},
	}),
}));
vi.mock("@/lib/supabase/server", () => ({
	createServerSupabase: async () => ({ from: (table: string) => query(table) }),
}));
vi.mock("@/lib/tenants/people", () => ({
	loadPeople: async (ids: string[]) =>
		new Map(
			ids.map((id) => [
				id,
				{ name: id === "u1" ? "Ana López" : "", email: `${id}@acme.test` },
			]),
		),
}));
vi.mock("next/navigation", () => ({
	notFound: () => {
		throw new Error("NEXT_NOT_FOUND");
	},
	useRouter: () => ({ refresh: () => {} }),
}));
vi.mock("@/app/[tenant]/settings/modelo-form", () => ({
	ModeloForm: () => null,
}));
vi.mock("@/app/[tenant]/settings/ingreso-form", () => ({
	IngresoForm: () => null,
}));
vi.mock("@/app/[tenant]/settings/config-actions", () => ({
	saveExecutor: async () => ({ ok: true }),
	removeExecutor: async () => ({ ok: true }),
	saveApproval: async () => ({ ok: true }),
	toggleConnection: async () => ({ ok: true }),
}));

const { default: SettingsPage } = await import("@/app/[tenant]/settings/page");
const render = async () =>
	renderToStaticMarkup(
		await SettingsPage({ params: Promise.resolve({ tenant: "acme" }) }),
	);

describe("settings del cliente", () => {
	beforeEach(() => {
		state.role = "tenant_admin";
		state.selects = {};
		state.tables = {
			tenants: {
				data: { allowed_domains: [], self_signup_by_domain: false },
				error: null,
			},
			memberships: {
				data: [{ user_id: "u1" }, { user_id: "u2" }],
				error: null,
			},
			executors: {
				data: [
					{
						user_id: "u1",
						slug: "ana",
						daily_quota: 40,
						gmail_authorized_at: null,
						display_name: null,
						title: null,
						linkedin_url: null,
						crm_owner_id: null,
					},
				],
				error: null,
			},
			tenant_agents: {
				data: [
					{
						agent: "outreach",
						enabled: true,
						config: { approvals: { "outreach/crm-record": "auto" } },
					},
				],
				error: null,
			},
			tenant_connections: {
				data: [
					{
						id: "c1",
						capability: "leads",
						provider: "coldiq",
						enabled: false,
						locked_by_platform: true,
					},
				],
				error: null,
			},
		};
	});

	describe("dominio propio (solo lectura)", () => {
		it("sin dominios no muestra la sección", async () => {
			expect(await render()).not.toContain("Tu dominio");
		});

		it("muestra el dominio y su estado, sin acciones", async () => {
			state.tables.tenant_domains = {
				data: [
					{ hostname: "ai.acme.com", is_primary: true, status: "active" },
					{
						hostname: "nuevo.acme.com",
						is_primary: false,
						status: "verifying",
					},
				],
				error: null,
			};
			const html = await render();
			expect(html).toContain("Tu dominio");
			expect(html).toContain("ai.acme.com");
			expect(html).toContain("Activo");
			expect(html).toContain("nuevo.acme.com");
			expect(html).toContain("Esperando el DNS");
			expect(html).not.toContain("Agregar dominio");
			expect(html).not.toContain("Verificar ahora");
		});

		it("si no se puede leer, la pantalla sigue sin esa sección", async () => {
			const error = vi.spyOn(console, "error").mockImplementation(() => {});
			state.tables.tenant_domains = { data: null, error: { message: "roto" } };
			const html = await render();
			expect(html).not.toContain("Tu dominio");
			expect(html).toContain("Agregar ejecutor");
			error.mockRestore();
		});
	});

	it("un miembro recibe 404", async () => {
		state.role = "tenant_member";
		await expect(render()).rejects.toThrow("NEXT_NOT_FOUND");
	});

	it("arma las tres secciones con lo que leyó", async () => {
		const html = await render();
		expect(html).toContain("Ana López");
		expect(html).toContain("Agregar ejecutor");
		expect(html).toMatch(/<option[^>]*value="u2"/);
		expect(html).toMatch(/<option[^>]*value="auto"[^>]*selected/);
		expect(html).toContain("Deshabilitado por INNOV.AS");
	});

	it("nunca le pide a la base el identificador ni la configuración del conector", async () => {
		await render();
		expect(state.selects.tenant_connections).not.toMatch(
			/connector_uid|config/,
		);
	});

	it("el link a outreach aparece solo con el agente outreach habilitado", async () => {
		expect(await render()).toContain('href="/acme/settings/outreach"');
		state.tables.tenant_agents = {
			data: [{ agent: "outreach", enabled: false, config: {} }],
			error: null,
		};
		expect(await render()).not.toContain("/acme/settings/outreach");
		state.tables.tenant_agents = { data: [], error: null };
		expect(await render()).not.toContain("/acme/settings/outreach");
	});

	it("un agente deshabilitado no ofrece aprobaciones", async () => {
		state.tables.tenant_agents = {
			data: [
				{ agent: "outreach", enabled: true, config: {} },
				{ agent: "otro", enabled: false, config: {} },
			],
			error: null,
		};
		const html = await render();
		expect(html).toContain("Aprobaciones");
		expect(html).not.toContain("otro");
	});

	it("solo con el Asistente no muestra Ejecutores ni Aprobaciones", async () => {
		state.tables.tenant_agents = {
			data: [{ agent: "asistente", enabled: true, config: {} }],
			error: null,
		};
		const html = await render();
		expect(html).toContain("Modelo default");
		expect(html).toContain("Conectores");
		expect(html).not.toContain("Ejecutores");
		expect(html).not.toContain("Aprobaciones");
	});

	it("sin agentes habilitados quedan Ingreso y Usuarios", async () => {
		state.tables.tenant_agents = {
			data: [{ agent: "outreach", enabled: false, config: {} }],
			error: null,
		};
		const html = await render();
		expect(html).toContain("Configuración de Acme");
		expect(html).toContain("Ingreso");
		expect(html).toContain('href="/acme/settings/usuarios"');
		for (const section of [
			"Modelo default",
			"Ejecutores",
			"Aprobaciones",
			"Conectores",
		])
			expect(html).not.toContain(section);
	});

	it("si no se pudieron leer los agentes, se muestra todo", async () => {
		const log = vi.spyOn(console, "error").mockImplementation(() => {});
		try {
			state.tables.tenant_agents = { data: null, error: { message: "boom" } };
			const html = await render();
			for (const section of [
				"Modelo default",
				"Ejecutores",
				"Aprobaciones",
				"Conectores",
			])
				expect(html).toContain(section);
		} finally {
			log.mockRestore();
		}
	});

	const emptyState: Record<string, string[]> = {
		executors: [
			"Todavía no hay ejecutores configurados",
			"Todos los miembros ya son ejecutores",
		],
		memberships: [
			"Todavía no hay ejecutores configurados",
			"Todos los miembros ya son ejecutores",
		],
		tenant_agents: ["No hay pasos que requieran una política"],
		tenant_connections: ["Todavía no hay conexiones configuradas"],
	};

	it.each(["executors", "memberships", "tenant_agents", "tenant_connections"])(
		"si falla la lectura de %s, lo dice y no muestra una sección vacía como si fuera cierta",
		async (table) => {
			const log = vi.spyOn(console, "error").mockImplementation(() => {});
			try {
				state.tables[table] = { data: null, error: { message: "boom" } };
				const html = await render();
				expect(html).toContain("No pude leer esta sección");
				for (const text of emptyState[table] ?? [])
					expect(html).not.toContain(text);
				expect(log).toHaveBeenCalled();
			} finally {
				log.mockRestore();
			}
		},
	);
});
