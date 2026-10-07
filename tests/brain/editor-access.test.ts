// Value: protects=el contexto del editor entrega un proveedor que filtra por los permisos del miembro y un access(path) coherente; los administradores no consultan reglas.
// fails_when=el proveedor del contexto no esta envuelto (el miembro ve paginas ocultas) o canEdit ignora una regla de editor sobre la raiz.
// why_new=editor-adapter.test.ts no ejercita las reglas; seam=none
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AccessRule } from "@/lib/brain/core/access/types";
import type { BrainProvider } from "@/lib/brain/core/types";

const state = vi.hoisted(() => ({
	access: null as unknown,
	rules: [] as unknown[],
	loads: [] as string[],
	raw: null as unknown,
}));

vi.mock("@/lib/tenants/resolve", () => ({
	resolveTenantAccess: vi.fn(async () => state.access),
}));

vi.mock("@/lib/connectors/bindings", () => ({
	loadTenantBindings: vi.fn(async () => [
		{
			id: "binding-1",
			tenantId: "tenant-a",
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

vi.mock("@/lib/brain/adapters/access-rules", () => ({
	accessRulesStore: () => ({
		load: async (tenantId: string) => {
			state.loads.push(tenantId);
			return state.rules;
		},
	}),
}));

const page = (slug: string) => ({
	slug,
	title: slug,
	category: "comercial",
	status: "activo" as const,
	tags: [],
	frontmatter: {},
	body: "x",
	revision: 1,
	updatedAt: "2026-10-01T00:00:00Z",
});

const raw = {
	search: vi.fn(async () => []),
	read: vi.fn(),
	list: vi.fn(async () => [
		page("comercial/icp"),
		page("direccion/presupuesto"),
	]),
	history: vi.fn(async () => null),
	upsert: vi.fn(),
} satisfies BrainProvider;

// El proveedor real se arma después de los mocks: se lee de state al llamar.
state.raw = raw;
vi.mock("@/lib/brain/adapters/provider", () => ({
	getBrainProvider: () => state.raw,
}));

import { loadEditorContext } from "@/lib/brain/adapters/editor";

function tenantAccess(role: string, userId = "ana") {
	return {
		id: "tenant-a",
		slug: "acme",
		displayName: "Acme",
		role,
		userId,
		defaultModel: "m",
		allowedModels: ["m"],
		brand: {},
	};
}

const closeDireccion: AccessRule[] = [
	{ path: "", principal: "members", userId: null, level: "lector" },
	{ path: "direccion", principal: "members", userId: null, level: "ninguno" },
];

describe("loadEditorContext · permisos", () => {
	beforeEach(() => {
		state.rules = [];
		state.loads = [];
	});

	it("un miembro lista solo lo que ve, y access responde por ruta", async () => {
		state.access = tenantAccess("tenant_member");
		state.rules = closeDireccion;
		const ctx = await loadEditorContext("acme-1");
		if (ctx?.kind !== "ok") throw new Error("se esperaba un contexto ok");
		expect((await ctx.provider.list()).map((p) => p.slug)).toEqual([
			"comercial/icp",
		]);
		expect(ctx.access("comercial/icp")).toBe("lector");
		expect(ctx.access("direccion/presupuesto")).toBeNull();
		expect(ctx.canEdit).toBe(false);
		expect(state.loads).toEqual(["tenant-a"]);
	});

	it("una regla de editor sobre la raíz habilita canEdit a un miembro", async () => {
		state.access = tenantAccess("tenant_member");
		state.rules = [
			{ path: "", principal: "members", userId: null, level: "editor" },
		];
		const ctx = await loadEditorContext("acme-2");
		if (ctx?.kind !== "ok") throw new Error("se esperaba un contexto ok");
		expect(ctx.canEdit).toBe(true);
	});

	it("un tenant_admin ve todo, edita y no consulta reglas", async () => {
		state.access = tenantAccess("tenant_admin", "root");
		state.rules = closeDireccion;
		const ctx = await loadEditorContext("acme-3");
		if (ctx?.kind !== "ok") throw new Error("se esperaba un contexto ok");
		expect((await ctx.provider.list()).map((p) => p.slug)).toEqual([
			"comercial/icp",
			"direccion/presupuesto",
		]);
		expect(ctx.canEdit).toBe(true);
		expect(ctx.access("direccion/presupuesto")).toBe("administrador");
		expect(ctx.provider).toBe(raw);
		expect(state.loads).toEqual([]);
	});
});
