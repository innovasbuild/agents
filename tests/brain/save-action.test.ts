// Value: protects=la server action real saveBrainPage aplica los permisos por carpeta del brain al guardar desde la web.
// fails_when=la action vuelve a armar su propio proveedor sin reglas, o un miembro sin permiso de edicion llega a upsert.
// why_new=editor-save prueba savePage con deps falsas; ninguno cubre el cableado real de actions.ts; seam=next/cache, tenants, bindings, provider, reglas
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BrainRole } from "@/lib/brain/core/types";

const state = vi.hoisted(() => ({
	role: "tenant_member" as string,
	userId: "u-1",
	rules: [] as unknown[],
	load: vi.fn(async (_tenantId: string): Promise<unknown[]> => []),
	upsert: vi.fn(async (..._args: unknown[]) => ({ slug: "", revision: 0 })),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/tenants/resolve", () => ({
	resolveTenantAccess: async () => ({
		id: "tenant-a",
		slug: "tenant-a",
		role: state.role,
		userId: state.userId,
	}),
}));
vi.mock("@/lib/connectors/bindings", () => ({
	loadTenantBindings: async () => [
		{
			id: "b1",
			tenantId: "tenant-a",
			provider: "wiki",
			capability: "brain",
			connectorUid: null,
			config: {
				categories: ["comercial"],
				requiredFrontmatter: [],
				search: "fts",
			},
		},
	],
}));
vi.mock("@/lib/brain/adapters/provider", () => ({
	getBrainProvider: () => ({
		search: vi.fn(),
		read: vi.fn(),
		list: async () => [],
		history: async () => null,
		upsert: state.upsert,
	}),
}));
vi.mock("@/lib/brain/adapters/access-rules", () => {
	const load = (tenantId: string) => state.load(tenantId);
	return { accessRulesStore: () => ({ load }), loadAccessRules: load };
});

import { saveBrainPage } from "@/app/[tenant]/brain/actions";

const input = {
	tenantSlug: "tenant-a",
	slug: "comercial/icp",
	title: "ICP",
	category: "comercial",
	status: "activo" as const,
	tags: [],
	frontmatter: {},
	body: "texto",
	reason: "ajuste",
	baseRevision: 1,
};

describe("saveBrainPage · permisos del brain", () => {
	beforeEach(() => {
		state.userId = "u-1";
		state.load = vi.fn(async () => state.rules);
		state.upsert = vi.fn(async () => ({ slug: "comercial/icp", revision: 2 }));
	});

	it("un miembro con la raíz en 'ninguno' no escribe y no llega al proveedor", async () => {
		state.role = "tenant_member" satisfies BrainRole;
		state.rules = [
			{ path: "", principal: "members", userId: null, level: "ninguno" },
		];
		const result = await saveBrainPage(input);
		expect(result).toMatchObject({ ok: false, code: "forbidden" });
		expect(state.upsert).not.toHaveBeenCalled();
	});

	it("un miembro con regla de editor sobre la carpeta guarda como esa persona", async () => {
		state.role = "tenant_member";
		state.rules = [
			{ path: "comercial", principal: "user", userId: "u-1", level: "editor" },
		];
		const result = await saveBrainPage(input);
		expect(result).toMatchObject({ ok: true });
		expect(state.upsert).toHaveBeenCalledTimes(1);
		expect(state.upsert.mock.calls[0][1]).toMatchObject({
			kind: "user",
			userId: "u-1",
		});
	});

	it("un administrador guarda sin consultar las reglas", async () => {
		state.role = "tenant_admin";
		const result = await saveBrainPage(input);
		expect(result).toMatchObject({ ok: true });
		expect(state.load).not.toHaveBeenCalled();
	});
});
