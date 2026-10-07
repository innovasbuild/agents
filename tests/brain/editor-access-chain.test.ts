// Value: protects=un miembro del tenant A que pide /B/brain/raw/x recibe 404 y nunca se consulta brain_pages con
//   service role; con sesion y membresia propia lee y la consulta lleva el tenant_id de A.
// fails_when=resolveTenantAccess deja pasar a un no miembro (o a un tenant inactivo), o el proveedor se arma con un
//   tenant que no es el resuelto: el editor ya no tiene la RLS como respaldo.
// why_new=cada eslabon se prueba con el anterior mockeado; ninguno junta el chequeo real con las lecturas admin; seam=none
import { beforeEach, describe, expect, it, vi } from "vitest";

type Row = Record<string, unknown>;

const state = vi.hoisted(() => ({
	user: null as { id: string } | null,
	tenants: [] as Row[],
	memberships: [] as Row[],
	pages: [] as Row[],
	pageQueries: [] as Array<Record<string, unknown>>,
}));

// Cliente de sesión: lo único que usa resolveTenantAccess.
vi.mock("@/lib/supabase/server", () => ({
	createServerSupabase: async () => ({
		auth: { getUser: async () => ({ data: { user: state.user } }) },
		from: (table: string) => {
			const filters: Record<string, unknown> = {};
			const chain = {
				select: () => chain,
				eq: (column: string, value: unknown) => {
					filters[column] = value;
					return chain;
				},
				maybeSingle: async () => {
					const rows = table === "tenants" ? state.tenants : state.memberships;
					const hit = rows.find((row) =>
						Object.entries(filters).every(([key, value]) => row[key] === value),
					);
					return { data: hit ?? null };
				},
			};
			return chain;
		},
	}),
}));

// Cliente admin (service role): lo único que lee las páginas.
vi.mock("@/lib/supabase/admin", () => ({
	createAdminClient: () => ({
		from: (table: string) => {
			const filters: Record<string, unknown> = {};
			const chain = {
				select: () => chain,
				eq: (column: string, value: unknown) => {
					filters[column] = value;
					return chain;
				},
				maybeSingle: async () => {
					if (table === "brain_pages") state.pageQueries.push({ ...filters });
					const hit = state.pages.find((row) =>
						Object.entries(filters).every(([key, value]) => row[key] === value),
					);
					return { data: hit ?? null, error: null };
				},
			};
			return chain;
		},
	}),
}));

vi.mock("@/lib/connectors/bindings", () => ({
	loadTenantBindings: vi.fn(async (tenantId: string) => [
		{
			id: `binding-${tenantId}`,
			tenantId,
			capability: "brain",
			provider: "wiki",
			connectorUid: null,
			config: {
				categories: ["comercial"],
				requiredFrontmatter: [],
				search: "fts",
			},
		},
	]),
}));

import { GET } from "@/app/[tenant]/brain/raw/[...slug]/route";

function tenantRow(id: string, slug: string, active = true): Row {
	return {
		id,
		slug,
		active,
		display_name: slug,
		default_model: "anthropic/claude-sonnet-5",
		allowed_models: ["anthropic/claude-sonnet-5"],
		brand: {},
	};
}

function pageRow(tenantId: string, body: string): Row {
	return {
		tenant_id: tenantId,
		slug: "comercial/icp",
		title: "ICP",
		category: "comercial",
		status: "activo",
		tags: [],
		frontmatter: {},
		body,
		revision: 1,
		updated_at: "2026-10-01T00:00:00Z",
	};
}

function call(tenant: string) {
	return GET(
		new Request(`http://localhost/${tenant}/brain/raw/comercial/icp`),
		{
			params: Promise.resolve({ tenant, slug: ["comercial", "icp"] }),
		},
	);
}

describe("lectura raw del brain · cadena real de acceso", () => {
	beforeEach(() => {
		// Sin dueño de plataforma: isPlatformOwnerAdmin es falso para todos.
		delete process.env.PLATFORM_OWNER_TENANT_SLUG;
		state.user = { id: "user-a" };
		state.tenants = [
			tenantRow("tenant-a", "acme"),
			tenantRow("tenant-b", "globex"),
			tenantRow("tenant-c", "dormida", false),
		];
		// user-a es miembro de acme y de nada más.
		state.memberships = [
			{ tenant_id: "tenant-a", user_id: "user-a", role: "tenant_member" },
		];
		state.pages = [
			pageRow("tenant-a", "cuerpo de acme"),
			pageRow("tenant-b", "cuerpo de globex"),
		];
		state.pageQueries = [];
	});

	it("un miembro lee su tenant y la consulta lleva el tenant_id de ese tenant", async () => {
		const response = await call("acme");
		expect(response.status).toBe(200);
		expect(await response.text()).toBe("cuerpo de acme");
		expect(state.pageQueries).toEqual([
			{ tenant_id: "tenant-a", slug: "comercial/icp" },
		]);
	});

	it("un miembro de A que pide el tenant B recibe 404 y no se lee brain_pages", async () => {
		const response = await call("globex");
		expect(response.status).toBe(404);
		expect(await response.text()).not.toContain("globex");
		expect(state.pageQueries).toEqual([]);
	});

	it("sin sesión recibe 404 y no se lee brain_pages", async () => {
		state.user = null;
		const response = await call("acme");
		expect(response.status).toBe(404);
		expect(state.pageQueries).toEqual([]);
	});

	it("un tenant inactivo recibe 404 aunque haya membresía", async () => {
		state.memberships.push({
			tenant_id: "tenant-c",
			user_id: "user-a",
			role: "tenant_admin",
		});
		const response = await call("dormida");
		expect(response.status).toBe(404);
		expect(state.pageQueries).toEqual([]);
	});
});
