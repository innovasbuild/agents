import { beforeEach, describe, expect, it, vi } from "vitest";

const calls = vi.hoisted(() => ({
	updates: [] as unknown[],
	inserts: [] as unknown[],
}));

vi.mock("../../lib/supabase/admin", () => ({
	createAdminClient: () => ({
		from: () => ({
			update(values: unknown) {
				calls.updates.push(values);
				return {
					eq: () => ({
						// closeRun encadena dos eq; bindSessionToConversation cierra
						// con select().maybeSingle().
						eq: async () => ({ error: null }),
						select: () => ({
							maybeSingle: async () => ({
								data: { id: "conv-1" },
								error: null,
							}),
						}),
					}),
				};
			},
			insert: async (values: unknown) => {
				calls.inserts.push(values);
				return { error: null };
			},
		}),
	}),
}));

const { bindSessionToConversation, openRun } = await import(
	"@/lib/agents/session-store"
);

beforeEach(() => {
	calls.updates = [];
	calls.inserts = [];
});

describe("bindSessionToConversation", () => {
	it("escribe el session id en la conversación", async () => {
		await bindSessionToConversation("conv-1", "wrun_A");
		expect(calls.updates[0]).toMatchObject({ eve_session_id: "wrun_A" });
	});

	it("tira si falta el id de conversación, para que el turno falle", async () => {
		await expect(bindSessionToConversation("", "wrun_A")).rejects.toThrow();
	});
});

describe("openRun", () => {
	it("inserta el run en estado running", async () => {
		await openRun({
			tenantId: "tenant-1",
			conversationId: "conv-1",
			agent: "outreach",
			sessionId: "wrun_A",
			turnId: "turn-1",
		});

		expect(calls.inserts[0]).toMatchObject({
			tenant_id: "tenant-1",
			agent: "outreach",
			trigger: "chat",
			eve_session_id: "wrun_A",
			eve_turn_id: "turn-1",
			status: "running",
		});
	});
});
