// Cablea la wiring de seguridad de brain.ts (spec brain §3 y §4.1): sin
// binding no hay tools, solo brain_upsert lleva approval, y esa approval
// queda atada al tenant del binding YA resuelto para esta sesión, no a
// cualquier otro. No repite la cobertura de lib/brain/wiki.ts (tests/brain/
// wiki.test.ts) ni de decideBrainUpsertResponse (tests/brain/approval.test.ts):
// esto es solo la composición en brain.ts.

import type { DynamicResolveContext } from "eve/tools";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Binding } from "@/lib/connectors/providers";

const wikiConfig = {
	categories: ["comercial"],
	requiredFrontmatter: [],
	search: "fts",
};

function binding(overrides: Partial<Binding> = {}): Binding {
	return {
		id: "binding-1",
		tenantId: "tenant-a",
		capability: "brain",
		provider: "wiki",
		connectorUid: null,
		config: wikiConfig,
		...overrides,
	};
}

const state = vi.hoisted(() => ({ bindings: [] as Binding[] }));

vi.mock("@/lib/connectors/bindings", () => ({
	loadTenantBindings: vi.fn(async () => state.bindings),
}));

// No debe llegar a Supabase de verdad: brain_upsert/read/search solo lo
// invocan dentro de execute(), que este archivo no ejercita.
vi.mock("@/lib/supabase/admin", () => ({
	createAdminClient: vi.fn(() => ({})),
}));

const { default: brainDynamic } = await import("@/agents/outreach/tools/brain");

function ctxFor(tenantId: string): DynamicResolveContext {
	return {
		session: {
			id: "session-1",
			auth: {
				initiator: { attributes: { tenantId } },
				current: null,
			},
		},
		channel: {},
		messages: [],
	} as unknown as DynamicResolveContext;
}

async function resolveTools(tenantId: string) {
	const handler = brainDynamic.events["session.started"];
	if (!handler) throw new Error("brain.ts no define session.started");
	return handler({}, ctxFor(tenantId));
}

describe("brain.ts: tools dinámicas del brain por tenant", () => {
	beforeEach(() => {
		state.bindings = [];
	});

	it("sin binding de brain válido no expone ninguna tool", async () => {
		state.bindings = [];
		expect(await resolveTools("tenant-a")).toBeNull();
	});

	it("con binding wiki expone exactamente brain_search, brain_read y brain_upsert", async () => {
		state.bindings = [binding()];
		const tools = await resolveTools("tenant-a");
		expect(tools).not.toBeNull();
		expect(Object.keys(tools as object).sort()).toEqual([
			"brain_read",
			"brain_search",
			"brain_upsert",
		]);
	});

	it("solo brain_upsert lleva approval", async () => {
		state.bindings = [binding()];
		const tools = (await resolveTools("tenant-a")) as Record<
			string,
			{ approval?: { request?: unknown; response?: unknown } }
		>;

		expect(tools.brain_search.approval).toBeUndefined();
		expect(tools.brain_read.approval).toBeUndefined();
		expect(tools.brain_upsert.approval).toBeDefined();
		expect(tools.brain_upsert.approval?.request).toBeDefined();
	});

	it("la aprobación de brain_upsert queda atada al tenant del binding resuelto para esta sesión, no a cualquier otro admin", async () => {
		state.bindings = [binding()];
		const tools = (await resolveTools("tenant-a")) as Record<
			string,
			{
				approval?: {
					response: (ctx: {
						responder: { attributes: Record<string, unknown> };
					}) => unknown;
				};
			}
		>;
		const response = tools.brain_upsert.approval?.response;
		if (!response) throw new Error("brain_upsert sin approval.response");

		// Mismo tenant que resolvió el binding de esta sesión (tenant-a):
		// un tenant_admin aprueba.
		expect(
			await response({
				responder: {
					attributes: { tenantId: "tenant-a", role: "tenant_admin" },
				},
			}),
		).toEqual({ status: "allowed" });

		// Otro tenant, aunque sea platform_admin: rechazado. Este es el
		// punto exacto que la revisión de la tarea 7 verificó leyendo el
		// código a mano; acá queda fijado con un test real.
		expect(
			await response({
				responder: {
					attributes: { tenantId: "otro-tenant", role: "platform_admin" },
				},
			}),
		).toMatchObject({ status: "rejected" });
	});
});
