// Value: protects=las tools del brain y el modelo del asistente se resuelven con la fila tenant_agents de "asistente", no con la de outreach; fails_when=el wrapper pasa otro nombre de agente a brainTools o tenantModel; why_new=brain.test.ts de outreach fija un solo agente y su mock ignora el valor de agent; seam=none; no_claim=comportamiento de las tools ya cubierto en outreach/tools/brain.test.ts (admin y binding simulados)
import type { DynamicResolveContext } from "eve/tools";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
	agentFilters: [] as string[],
	modelCalls: [] as unknown[][],
}));

vi.mock("@/lib/connectors/bindings", () => ({
	loadTenantBindings: async () => [
		{
			id: "b1",
			tenantId: "t1",
			capability: "brain",
			provider: "wiki",
			connectorUid: null,
			config: { categories: ["x"], requiredFrontmatter: [], search: "fts" },
		},
	],
}));
vi.mock("@/lib/supabase/admin", () => ({
	createAdminClient: () => ({
		from: () => ({
			select: () => ({
				eq: () => ({
					eq: (column: string, value: string) => {
						if (column === "agent") state.agentFilters.push(value);
						return {
							maybeSingle: async () => ({
								// Solo hay declaración de brain para el asistente.
								data:
									value === "asistente"
										? { config: { brain: "read" } }
										: { config: {} },
								error: null,
							}),
						};
					},
				}),
			}),
		}),
	}),
}));
vi.mock("@/lib/agents/model", () => ({
	resolveModelForTenant: async (...args: unknown[]) => {
		state.modelCalls.push(args);
		return "anthropic/claude-haiku-4.5";
	},
}));

const { default: brain } = await import("@/agents/asistente/tools/brain");
const { tenantModel } = await import("@/lib/agents/eve/model");

function ctx(attributes: Record<string, unknown>): DynamicResolveContext {
	return {
		session: {
			id: "s1",
			auth: { initiator: { attributes }, current: null },
		},
		channel: {},
		messages: [],
	} as unknown as DynamicResolveContext;
}

beforeEach(() => {
	state.agentFilters = [];
	state.modelCalls = [];
});

describe("agente asistente", () => {
	it("las tools del brain salen de la declaración del asistente", async () => {
		const handler = brain.events["session.started"];
		if (!handler) throw new Error("brain.ts no define session.started");

		const tools = await handler({}, ctx({ tenantId: "t1" }));

		expect(state.agentFilters).toEqual(["asistente"]);
		expect(Object.keys(tools as object).sort()).toEqual([
			"brain_read",
			"brain_search",
		]);
	});

	it("el modelo se resuelve para el agente y la conversación de la sesión", async () => {
		const handler = tenantModel("asistente").events["session.started"];
		if (!handler) throw new Error("tenantModel no define session.started");

		const model = await handler(
			{},
			ctx({ tenantId: "t1", conversationId: "c1" }),
		);

		expect(model).toBe("anthropic/claude-haiku-4.5");
		expect(state.modelCalls).toEqual([["t1", "asistente", "c1"]]);
	});

	it("sin tenant en el principal, el modelo es el default de la plataforma", async () => {
		const handler = tenantModel("asistente").events["session.started"];
		if (!handler) throw new Error("tenantModel no define session.started");

		expect(await handler({}, ctx({}))).toBe("anthropic/claude-sonnet-5");
		expect(state.modelCalls).toEqual([]);
	});
});
