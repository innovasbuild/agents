import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
	agents: [{ agent: "outreach" }] as { agent: string }[] | null,
	agentsError: null as { message: string } | null,
}));

vi.mock("react", async (original) => ({
	...(await original<typeof import("react")>()),
	cache: <T>(fn: T) => fn,
}));
vi.mock("@/lib/tenants/resolve", () => ({
	resolveTenantAccess: async (slug: string) =>
		slug === "acme" ? { id: "t1", slug: "acme" } : null,
}));
vi.mock("@/lib/supabase/server", () => ({
	createServerSupabase: async () => ({
		from: (table: string) => {
			const result =
				table === "tenant_agents"
					? { data: state.agents, error: state.agentsError }
					: { data: [], error: null };
			const q = {
				select: () => q,
				eq: () => q,
				maybeSingle: async () => ({
					data: { id: "f1", name: "Foco uno" },
					error: null,
				}),
				// biome-ignore lint/suspicious/noThenProperty: imita el builder de supabase-js
				then: (resolve: (v: unknown) => unknown) =>
					Promise.resolve(result).then(resolve),
			};
			return q;
		},
	}),
}));
const notFound = vi.fn(() => {
	throw new Error("NOT_FOUND");
});
vi.mock("next/navigation", () => ({ notFound }));
vi.mock("@/app/[tenant]/focos/[id]/revisar/revisar-client", () => ({
	RevisarClient: () => null,
}));

const { default: RevisarPage } = await import(
	"@/app/[tenant]/focos/[id]/revisar/page"
);
const { RevisarClient } = await import(
	"@/app/[tenant]/focos/[id]/revisar/revisar-client"
);

const params = Promise.resolve({ tenant: "acme", id: "f1" });

beforeEach(() => {
	state.agents = [{ agent: "outreach" }];
	state.agentsError = null;
	notFound.mockClear();
});

describe("revisar: guard del agente outreach", () => {
	it("da 404 si la empresa no tiene outreach habilitado", async () => {
		state.agents = [];
		await expect(RevisarPage({ params })).rejects.toThrow("NOT_FOUND");
	});

	it("con outreach habilitado muestra la pantalla", async () => {
		const page = await RevisarPage({ params });
		expect(page.type).toBe(RevisarClient);
		expect(notFound).not.toHaveBeenCalled();
	});

	it("si no se pueden leer los agentes, muestra la pantalla igual", async () => {
		const log = vi.spyOn(console, "error").mockImplementation(() => {});
		state.agents = null;
		state.agentsError = { message: "caída" };
		const page = await RevisarPage({ params });
		expect(page.type).toBe(RevisarClient);
		log.mockRestore();
	});
});
