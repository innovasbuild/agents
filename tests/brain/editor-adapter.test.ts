// Value: protects=loadRevisions muestra el email del autor solo si es miembro del tenant del ctx; autor null y
//   history null pasan como null; authorUserId no sale en las filas.
// fails_when=se quita el filtro de membresia por tenant (fuga de email entre empresas) o se rompe el mapeo.
// why_new=ningun test toca lib/brain/adapters/editor.ts; seam=none
// Value: protects=loadEditorContext devuelve null/no-brain/external/ok.
// fails_when=se invierte el chequeo de rol o de proveedor (mcp se trata como wiki).
// why_new=el contexto gatea todas las paginas del brain y nada lo prueba; seam=none

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { OkEditorContext } from "@/lib/brain/adapters/editor";
import type { BrainRevision } from "@/lib/brain/core/types";
import type { Binding } from "@/lib/connectors/providers";
import type { TenantAccess } from "@/lib/tenants/resolve";

const state = vi.hoisted(() => ({
	bindings: [] as unknown[],
	access: null as unknown,
	// user_id -> tenants donde tiene membresia; user_id -> email
	memberships: [] as Array<{ tenant_id: string; user_id: string }>,
	emails: {} as Record<string, string>,
	membershipError: null as { message: string } | null,
	lookups: [] as string[],
	membershipQueries: [] as Array<{
		table: string;
		eq: Record<string, unknown>;
		in: Record<string, unknown[]>;
	}>,
}));

vi.mock("@/lib/connectors/bindings", () => ({
	loadTenantBindings: vi.fn(async () => state.bindings),
}));

vi.mock("@/lib/brain/adapters/access-rules", () => ({
	accessRulesStore: () => ({ load: async () => [] }),
}));

vi.mock("@/lib/tenants/resolve", () => ({
	resolveTenantAccess: vi.fn(async () => state.access),
}));

vi.mock("@/lib/supabase/admin", () => ({
	createAdminClient: vi.fn(() => ({
		from: (table: string) => {
			const query = {
				table,
				eq: {} as Record<string, unknown>,
				in: {} as Record<string, unknown[]>,
			};
			const chain = {
				select: () => chain,
				eq: (column: string, value: unknown) => {
					query.eq[column] = value;
					return chain;
				},
				in: (column: string, values: unknown[]) => {
					query.in[column] = values;
					state.membershipQueries.push(query);
					const rows = state.memberships
						.filter(
							(m) =>
								m.tenant_id === query.eq.tenant_id &&
								values.includes(m.user_id),
						)
						.map((m) => ({ user_id: m.user_id }));
					if (state.membershipError)
						return Promise.resolve({
							data: null,
							error: state.membershipError,
						});
					return Promise.resolve({ data: rows, error: null });
				},
			};
			return chain;
		},
		auth: {
			admin: {
				getUserById: async (id: string) => {
					state.lookups.push(id);
					return {
						data: {
							user: state.emails[id] ? { email: state.emails[id] } : null,
						},
					};
				},
			},
		},
	})),
}));

import { loadEditorContext, loadRevisions } from "@/lib/brain/adapters/editor";

function tenant(overrides: Partial<TenantAccess> = {}): TenantAccess {
	return {
		id: "tenant-a",
		slug: "acme",
		displayName: "Acme",
		role: "tenant_admin",
		userId: "user-1",
		defaultModel: "m",
		allowedModels: ["m"],
		brand: {},
		...overrides,
	} as TenantAccess;
}

function revision(
	n: number,
	authorUserId: string | null,
	overrides: Partial<BrainRevision> = {},
): BrainRevision {
	return {
		revision: n,
		title: "ICP",
		category: "comercial",
		status: "activo",
		tags: [],
		frontmatter: {},
		body: `v${n}`,
		authorKind: "user",
		authorUserId,
		reason: "ajuste",
		createdAt: "2026-10-02T00:00:00Z",
		...overrides,
	} as BrainRevision;
}

function ctxWith(history: BrainRevision[] | null): OkEditorContext {
	return {
		kind: "ok",
		tenant: tenant(),
		categories: ["comercial"],
		provider: { history: vi.fn(async () => history) },
	} as unknown as OkEditorContext;
}

beforeEach(() => {
	state.bindings = [];
	state.access = null;
	state.memberships = [];
	state.emails = {};
	state.membershipQueries = [];
});

describe("loadRevisions", () => {
	it("devuelve null cuando la página no tiene historial", async () => {
		expect(await loadRevisions(ctxWith(null), "comercial/icp")).toBeNull();
		expect(state.membershipQueries).toEqual([]);
	});

	it("muestra el email solo de quien es miembro del tenant del ctx", async () => {
		state.memberships = [
			{ tenant_id: "tenant-a", user_id: "user-member" },
			// user-ajeno es miembro de OTRO tenant, no del del ctx
			{ tenant_id: "tenant-b", user_id: "user-ajeno" },
		];
		state.emails = {
			"user-member": "ana@acme.com",
			"user-ajeno": "secreto@otra-empresa.com",
		};
		const rows = await loadRevisions(
			ctxWith([revision(3, "user-ajeno"), revision(2, "user-member")]),
			"comercial/icp",
		);

		expect(rows?.map((r) => r.authorEmail)).toEqual([null, "ana@acme.com"]);
		expect(JSON.stringify(rows)).not.toContain("otra-empresa.com");
		expect(state.membershipQueries).toHaveLength(1);
		expect(state.membershipQueries[0]).toMatchObject({
			table: "memberships",
			eq: { tenant_id: "tenant-a" },
		});
		expect(state.membershipQueries[0].in.user_id.sort()).toEqual([
			"user-ajeno",
			"user-member",
		]);
	});

	it("una revisión sin autor da authorEmail null y no se expone authorUserId", async () => {
		state.memberships = [{ tenant_id: "tenant-a", user_id: "user-member" }];
		state.emails = { "user-member": "ana@acme.com" };
		const rows = await loadRevisions(
			ctxWith([
				revision(2, null, { authorKind: "agent" }),
				revision(1, "user-member"),
			]),
			"comercial/icp",
		);

		expect(rows).toHaveLength(2);
		expect(rows?.[0]).toMatchObject({
			revision: 2,
			authorKind: "agent",
			authorEmail: null,
		});
		expect(rows?.[1]).toMatchObject({
			revision: 1,
			authorEmail: "ana@acme.com",
		});
		for (const row of rows ?? []) expect("authorUserId" in row).toBe(false);
		// solo se consulta por los autores no nulos
		expect(state.membershipQueries[0].in.user_id).toEqual(["user-member"]);
	});

	it("sin autores no consulta memberships", async () => {
		const rows = await loadRevisions(ctxWith([revision(1, null)]), "x");
		expect(rows?.[0].authorEmail).toBeNull();
		expect(state.membershipQueries).toEqual([]);
	});
});

function binding(overrides: Partial<Binding> = {}): Binding {
	return {
		id: "binding-1",
		tenantId: "tenant-a",
		capability: "brain",
		provider: "wiki",
		connectorUid: null,
		config: { categories: ["comercial", "ventas"] },
		...overrides,
	};
}

describe("loadEditorContext", () => {
	// cache() de react memoiza por argumento: un slug distinto por test.
	it("devuelve null si el usuario no tiene acceso al tenant", async () => {
		state.access = null;
		expect(await loadEditorContext("sin-acceso")).toBeNull();
	});

	it("devuelve no-brain si el tenant no tiene binding de brain", async () => {
		state.access = tenant();
		state.bindings = [];
		const ctx = await loadEditorContext("sin-brain");
		expect(ctx).toEqual({ kind: "no-brain", tenant: tenant() });
	});

	it("devuelve external si el brain es mcp", async () => {
		state.access = tenant();
		state.bindings = [
			binding({
				provider: "mcp",
				connectorUid: "conn-1",
				config: {
					url: "https://brain.cliente.test/mcp",
					categories: ["comercial"],
				},
			}),
		];
		const ctx = await loadEditorContext("brain-mcp");
		expect(ctx?.kind).toBe("external");
	});

	it("devuelve ok con categorías y proveedor; admin edita", async () => {
		state.access = tenant({ role: "tenant_admin" });
		state.bindings = [binding()];
		const ctx = await loadEditorContext("admin-ok");
		expect(ctx?.kind).toBe("ok");
		if (ctx?.kind !== "ok") return;
		expect(ctx.categories).toEqual(["comercial", "ventas"]);
		expect(typeof ctx.provider.read).toBe("function");
		expect(ctx.tenant.id).toBe("tenant-a");
	});
});

// Value: protects=loadRevisions deja registro cuando falla la consulta de membresias (no se ve como "autores sin
//   cuenta") y no hace mas de 50 consultas a Auth por vista de historial.
// fails_when=se vuelve a tragar el error de la base, o se quita el tope de autores y cada autor es una llamada mas.
// why_new=los tests existentes solo ejercen el camino sin errores y con pocos autores; seam=none
describe("loadRevisions · errores y tope de autores", () => {
	function okContext(history: BrainRevision[]) {
		return {
			kind: "ok",
			tenant: tenant(),
			categories: ["comercial"],
			provider: { history: vi.fn(async () => history) },
		} as unknown as OkEditorContext;
	}

	beforeEach(() => {
		state.memberships = [];
		state.emails = {};
		state.membershipError = null;
		state.lookups = [];
	});

	it("si falla la consulta de membresias lo registra y devuelve los autores sin email", async () => {
		state.membershipError = { message: "permiso denegado" };
		const logged = vi.spyOn(console, "error").mockImplementation(() => {});
		const rows = await loadRevisions(
			okContext([revision(1, "user-1")]),
			"comercial/icp",
		);
		expect(rows?.[0].authorEmail).toBeNull();
		expect(logged).toHaveBeenCalledWith(
			expect.stringContaining("permiso denegado"),
		);
		expect(state.lookups).toEqual([]);
		logged.mockRestore();
	});

	it("resuelve como mucho 50 emails por vista y avisa", async () => {
		const ids = Array.from({ length: 60 }, (_, i) => `user-${i}`);
		state.memberships = ids.map((id) => ({
			tenant_id: "tenant-a",
			user_id: id,
		}));
		state.emails = Object.fromEntries(ids.map((id) => [id, `${id}@acme.test`]));
		const warned = vi.spyOn(console, "warn").mockImplementation(() => {});
		const rows = await loadRevisions(
			okContext(ids.map((id, i) => revision(i + 1, id))),
			"comercial/icp",
		);
		expect(state.lookups).toHaveLength(50);
		expect(rows?.filter((r) => r.authorEmail !== null)).toHaveLength(50);
		expect(warned).toHaveBeenCalledWith(expect.stringContaining("60 autores"));
		warned.mockRestore();
	});
});
