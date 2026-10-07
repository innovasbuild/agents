import { describe, expect, it, vi } from "vitest";

vi.mock("react", async (orig) => ({
	...(await orig<typeof import("react")>()),
	cache: <T extends (...a: never[]) => unknown>(fn: T) => fn,
}));
vi.mock("@/lib/connectors/bindings", () => ({ loadTenantBindings: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/tenants/resolve", () => ({ resolveTenantAccess: vi.fn() }));
vi.mock("@/lib/brain/adapters/access-rules", () => ({
	accessRulesStore: () => ({ load: async () => [] }),
}));

const { loadBrainTree } = await import("@/lib/brain/adapters/editor");

const page = (slug: string) => ({
	slug,
	title: slug,
	category: "comercial",
	status: "activo" as const,
	tags: [],
	frontmatter: {},
	body: "secreto",
	revision: 1,
	updatedAt: "2026-10-07T00:00:00Z",
});

describe("loadBrainTree", () => {
	it("arma el árbol con lo que el contexto deja ver y sin cuerpos", async () => {
		const ctx = {
			kind: "ok",
			categories: ["comercial"],
			tenant: {},
			access: (path: string) => (path.startsWith("legal") ? null : "lector"),
			provider: {
				list: async () => [page("comercial/icp"), page("legal/contrato")],
			},
		} as never;
		const tree = await loadBrainTree(ctx);
		expect(tree.children.map((n) => n.path)).toEqual(["comercial"]);
		expect(JSON.stringify(tree)).not.toContain("secreto");
	});
});
