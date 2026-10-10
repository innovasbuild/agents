// tests/plataforma/list-page.test.ts
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

type Result = { data: unknown; error: unknown };
const state = {
	tenants: [] as unknown[],
	memberships: [] as unknown[],
	agents: [] as unknown[],
	connections: [] as unknown[],
	failing: null as string | null,
};

function query(result: () => Result) {
	const q = {
		select: () => q,
		order: () => q,
		returns: () => q,
		// biome-ignore lint/suspicious/noThenProperty: imita el builder de supabase-js
		then: (resolve: (value: Result) => unknown) =>
			Promise.resolve(result()).then(resolve),
	};
	return q;
}

vi.mock("@/lib/tenants/platform", () => ({
	platformOwnerSlug: () => "innovas",
	requirePlatformAdmin: async () => ({
		userId: "u1",
		supabase: {
			from: (table: string) =>
				query(() => ({
					data:
						table === "tenants"
							? state.tenants
							: table === "memberships"
								? state.memberships
								: table === "tenant_agents"
									? state.agents
									: state.connections,
					error:
						table === state.failing ? { code: "XX000", message: "roto" } : null,
				})),
		},
	}),
}));
vi.mock("next/navigation", () => ({
	notFound: () => {
		throw new Error("NEXT_NOT_FOUND");
	},
}));

const { default: PlataformaPage } = await import("@/app/plataforma/page");

describe("listado de empresas", () => {
	beforeEach(() => {
		state.failing = null;
		state.tenants = [
			{
				id: "t1",
				slug: "acme",
				display_name: "Acme",
				active: true,
				created_at: "2026-10-01T00:00:00Z",
			},
			{
				id: "t2",
				slug: "beta",
				display_name: "Beta",
				active: true,
				created_at: "2026-10-01T00:00:00Z",
			},
		];
		state.memberships = [];
		state.agents = [{ tenant_id: "t1", agent: "outreach", enabled: true }];
		state.connections = [
			{
				tenant_id: "t1",
				capability: "brain",
				provider: "wiki",
				enabled: true,
				verified_at: null,
			},
			{
				tenant_id: "t1",
				capability: "crm",
				provider: "hubspot",
				enabled: true,
				verified_at: null,
			},
			{
				tenant_id: "t1",
				capability: "leads",
				provider: "coldiq",
				enabled: true,
				verified_at: "x",
			},
			{
				tenant_id: "t1",
				capability: "mail",
				provider: "gmail",
				enabled: true,
				verified_at: null,
			},
		];
	});

	it("resume qué le falta a cada empresa", async () => {
		const html = renderToStaticMarkup(await PlataformaPage());
		const acme = html.split("<li").find((li) => li.includes(">Acme<")) ?? "";
		const beta = html.split("<li").find((li) => li.includes(">Beta<")) ?? "";
		expect(acme).toContain("Lista");
		expect(beta).toContain("Faltan: sin agentes habilitados, sin brain");
	});

	it.each(["tenant_agents", "tenant_connections"])(
		"si falla leer %s, cada fila dice que no pudo leer el estado",
		async (table) => {
			const log = vi.spyOn(console, "error").mockImplementation(() => {});
			state.failing = table;
			const html = renderToStaticMarkup(await PlataformaPage());
			expect(html).toContain("No pude leer el estado");
			expect(html).not.toContain("Faltan:");
			expect(html).not.toContain(">Lista<");
			expect(log).toHaveBeenCalled();
			log.mockRestore();
		},
	);
});
