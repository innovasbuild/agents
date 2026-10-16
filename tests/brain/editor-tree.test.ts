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

const { loadBrainLinkIndex, loadBrainTree } = await import(
	"@/lib/brain/adapters/editor"
);

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
		const list = vi.fn();
		const ctx = {
			kind: "ok",
			categories: ["comercial"],
			tenant: {},
			skills: async () => [],
			folders: async () => [],
			access: (path: string) => (path.startsWith("legal") ? null : "lector"),
			provider: {
				list,
				listMeta: async () => [page("comercial/icp"), page("legal/contrato")],
			},
		} as never;
		const tree = await loadBrainTree(ctx);
		expect(tree.children.map((n) => n.path)).toEqual(["comercial"]);
		expect(JSON.stringify(tree)).not.toContain("secreto");
		// El árbol no necesita el cuerpo: no lo pide.
		expect(list).not.toHaveBeenCalled();
	});

	it("si no puede leer las skills, el árbol sale igual y lo deja en el log", async () => {
		const logged = vi.spyOn(console, "error").mockImplementation(() => {});
		const ctx = {
			kind: "ok",
			categories: ["comercial"],
			tenant: { slug: "acme" },
			folders: async () => [],
			skills: async () => {
				throw new Error("rpc caído");
			},
			access: () => "editor",
			provider: { listMeta: async () => [page("comercial/icp")] },
		} as never;
		const tree = await loadBrainTree(ctx);
		expect(tree.children.map((n) => n.path)).toEqual(["comercial"]);
		expect(logged).toHaveBeenCalledWith(
			expect.stringContaining("acme"),
			expect.any(Error),
		);
		logged.mockRestore();
	});

	it("una carpeta guardada sin páginas aparece con su descripción", async () => {
		const ctx = {
			kind: "ok",
			categories: ["marketing"],
			tenant: {},
			skills: async () => [],
			folders: async () => [{ path: "marketing", description: "Marca" }],
			access: () => "administrador",
			provider: { listMeta: async () => [] },
		} as never;
		const tree = await loadBrainTree(ctx);
		const node = tree.children.find((n) => n.path === "marketing");
		expect(node?.folder).toEqual({ description: "Marca" });
	});
});

describe("loadBrainLinkIndex", () => {
	it("arma las conexiones con metadatos y links, sin pedir el cuerpo", async () => {
		const list = vi.fn();
		const ctx = {
			kind: "ok",
			provider: {
				list,
				listMeta: async () => [page("a/uno"), page("b/dos"), page("c/sola")],
				listLinks: async () => [
					{
						slug: "a/uno",
						links: [
							{ target: "b/dos", alias: null, anchor: null },
							{ target: "x/rota", alias: null, anchor: null },
						],
					},
				],
			},
		} as never;
		const index = await loadBrainLinkIndex(ctx);
		expect(index.incoming.get("b/dos")).toEqual(["a/uno"]);
		expect(index.broken).toEqual([{ source: "a/uno", target: "x/rota" }]);
		expect(index.orphans).toEqual(["a/uno", "c/sola"]);
		expect(list).not.toHaveBeenCalled();
	});
});
