// Value: protects=draft_message y research_account mandan a generateText el tag tenant:<slug> del tenant de la sesión; fails_when=la puerta pierde providerOptions o resuelve otro tenant
// Value: why_new=model-calls.test.ts solo exige que el archivo nombre createGatewayOptions, no que el tag llegue a la llamada; seam=none; no_claim=tag en el gateway real (generateText, base y servicios mockeados)
import { generateText } from "ai";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ tenantIds: [] as string[] }));

vi.mock("ai", async (importOriginal) => ({
	...(await importOriginal<typeof import("ai")>()),
	generateText: vi.fn(async () => ({
		output: {},
		usage: {},
		providerMetadata: undefined,
	})),
}));
vi.mock("@/lib/supabase/admin", () => ({
	createAdminClient: () => ({
		from: () => ({
			select: () => ({
				eq: (_column: string, id: string) => {
					state.tenantIds.push(id);
					return { maybeSingle: async () => ({ data: { slug: "acme" } }) };
				},
			}),
		}),
	}),
}));
vi.mock("@/lib/workflows/usage", async (importOriginal) => ({
	...(await importOriginal<typeof import("@/lib/workflows/usage")>()),
	createUsageRecorder: () => async () => {},
	resolveRunId: async () => null,
}));
vi.mock("@/lib/outreach/canon", () => ({
	brainForTenant: async () => null,
	loadCanon: async () => ({}),
}));
vi.mock("@/lib/outreach/store", () => ({
	createSupabaseOutreachStore: () => ({}),
}));
// Los servicios se reemplazan por uno que invoca la dependencia `generate`
// que armó la puerta: lo que se prueba es esa dependencia, no el servicio.
vi.mock("@/lib/outreach/services/draft", () => ({
	draftMessage: async (
		_input: unknown,
		deps: { generate: (...args: string[]) => Promise<unknown> },
	) => {
		await deps.generate("m", "system", "prompt");
		return { ok: true };
	},
}));
vi.mock("@/lib/outreach/services/research", () => ({
	researchAccount: async (
		_input: unknown,
		deps: { generate: (args: unknown) => Promise<unknown> },
	) => {
		await deps.generate({
			model: "m",
			system: "system",
			prompt: "prompt",
			readPage: async () => ({ ok: false, reason: "x" }),
		});
		return { ok: true };
	},
}));

const { default: draftMessageTool } = await import(
	"@/agents/outreach/tools/draft_message"
);
const { default: researchAccountTool } = await import(
	"@/agents/outreach/tools/research_account"
);

const ctx = {
	abortSignal: undefined,
	session: {
		id: "wrun_1",
		turn: { id: "turn-1" },
		auth: {
			initiator: null,
			current: {
				principalType: "user",
				principalId: "u1",
				attributes: { tenantId: "tenant-uuid-1", role: "tenant_admin" },
			},
		},
	},
};

beforeEach(() => {
	state.tenantIds = [];
	vi.mocked(generateText).mockClear();
});

describe("las tools de outreach etiquetan su llamada al modelo", () => {
	it("draft_message manda el tag de la empresa de la sesión", async () => {
		// biome-ignore lint/suspicious/noExplicitAny: ctx de eve simulado.
		await (draftMessageTool as any).execute(
			{ contactKey: "em:ana@acme.test", kind: "msg1" },
			ctx,
		);
		expect(state.tenantIds).toEqual(["tenant-uuid-1"]);
		expect(generateText).toHaveBeenCalledWith(
			expect.objectContaining({
				providerOptions: { gateway: { tags: ["tenant:acme"] } },
			}),
		);
	});

	it("research_account manda el tag de la empresa de la sesión", async () => {
		// biome-ignore lint/suspicious/noExplicitAny: ctx de eve simulado.
		await (researchAccountTool as any).execute({ domain: "acme.test" }, ctx);
		expect(state.tenantIds).toEqual(["tenant-uuid-1"]);
		expect(generateText).toHaveBeenCalledWith(
			expect.objectContaining({
				providerOptions: { gateway: { tags: ["tenant:acme"] } },
			}),
		);
	});
});
