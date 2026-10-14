// Value: protects=el contexto de sesión del asistente nombra la empresa y solo los otros agentes habilitados; fails_when=se lista al propio asistente, se afirma algo con la base caída o se arma contexto sin persona; why_new=assistant-instructions.test.ts cubre el texto, no la lectura de la base ni sus ramas; seam=none; no_claim=lectura real de Supabase y cómo eve inyecta las instrucciones (admin y binding simulados)
import type { DynamicResolveContext } from "eve/tools";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
	tenant: { display_name: "Acme", slug: "acme" } as {
		display_name: string;
		slug: string;
	} | null,
	agentRows: [{ agent: "asistente" }, { agent: "outreach" }] as
		| { agent: string }[]
		| null,
	agentsError: null as { message: string } | null,
	brain: { id: "b" } as unknown,
}));

vi.mock("@/lib/supabase/admin", () => ({
	createAdminClient: () => ({
		from: (table: string) => {
			if (table === "tenants") {
				return {
					select: () => ({
						eq: () => ({
							maybeSingle: async () => ({ data: state.tenant, error: null }),
						}),
					}),
				};
			}
			return {
				select: () => ({
					eq: () => ({
						eq: async () => ({
							data: state.agentRows,
							error: state.agentsError,
						}),
					}),
				}),
			};
		},
	}),
}));
vi.mock("@/lib/brain/core/resolve", () => ({
	resolveBrainBinding: async () => state.brain,
}));
vi.mock("@/lib/connectors/bindings", () => ({
	loadTenantBindings: async () => [],
}));

const { default: dynamic } = await import(
	"@/agents/asistente/instructions/tenant"
);

function ctx(auth: unknown): DynamicResolveContext {
	return {
		session: { id: "s1", auth: { initiator: auth, current: null } },
		channel: {},
		messages: [],
	} as unknown as DynamicResolveContext;
}

const user = (tenantId = "t1") => ({
	principalType: "user",
	attributes: { tenantId },
});

async function resolve(auth: unknown): Promise<string | null> {
	const handler = dynamic.events["session.started"];
	if (!handler) throw new Error("tenant.ts no define session.started");
	const result = await handler({}, ctx(auth));
	return result === null ? null : JSON.stringify(result);
}

beforeEach(() => {
	state.tenant = { display_name: "Acme", slug: "acme" };
	state.agentRows = [{ agent: "asistente" }, { agent: "outreach" }];
	state.agentsError = null;
	state.brain = { id: "b" };
	vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("instructions/tenant del asistente", () => {
	it("sin tenantId en el principal no arma contexto", async () => {
		expect(await resolve({ principalType: "user", attributes: {} })).toBeNull();
	});

	it("un principal que no es una persona no arma contexto", async () => {
		expect(
			await resolve({
				principalType: "service",
				attributes: { tenantId: "t1" },
			}),
		).toBeNull();
	});

	it("si la empresa no existe no arma contexto", async () => {
		state.tenant = null;
		expect(await resolve(user())).toBeNull();
	});

	it("nombra la empresa y lista a los otros agentes sin incluir al asistente", async () => {
		const text = await resolve(user());

		expect(text).toContain("Trabajás para Acme");
		expect(text).toContain("Agente de outreach");
		expect(text).not.toContain("- Asistente:");
		expect(text).not.toContain("no tiene un brain conectado");
	});

	it("si el asistente es el único agente de chat, dice que no hay otros", async () => {
		state.agentRows = [{ agent: "asistente" }];

		expect(await resolve(user())).toContain(
			"No hay otros agentes habilitados en esta empresa.",
		);
	});

	it("sin brain conectado lo avisa", async () => {
		state.brain = null;

		expect(await resolve(user())).toContain("no tiene un brain conectado");
	});

	it("si la lectura de agentes falla, arranca igual y no afirma nada sobre otros agentes", async () => {
		state.agentsError = { message: "boom" };

		const text = await resolve(user());

		expect(text).toContain("Trabajás para Acme");
		expect(text).not.toContain("No hay otros agentes habilitados");
		expect(text).not.toContain("abran un hilo nuevo");
		expect(text).not.toContain("no tiene un brain conectado");
	});
});
