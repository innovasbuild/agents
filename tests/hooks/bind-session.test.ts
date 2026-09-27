import { beforeEach, describe, expect, it, vi } from "vitest";

const calls = vi.hoisted(() => ({ binds: [] as unknown[] }));

vi.mock("../../lib/agents/session-store", () => ({
	bindSessionToConversation: async (
		conversationId: string,
		sessionId: string,
	) => {
		calls.binds.push([conversationId, sessionId]);
	},
}));

const { default: hook } = await import("@/agents/outreach/hooks/bind-session");
// biome-ignore lint/suspicious/noExplicitAny: ctx de eve simulado.
const sessionStarted = (hook as any).events["session.started"];

function ctx(authenticator: string | undefined, conversationId?: string) {
	return {
		session: {
			id: "wrun_A",
			auth: {
				initiator: {
					authenticator,
					attributes: { conversationId },
				},
			},
		},
	};
}

beforeEach(() => {
	calls.binds = [];
});

describe("hook de bind-session", () => {
	it("una sesión oauth no ata ninguna conversación", async () => {
		await sessionStarted({}, ctx("oauth", "conv-1"));
		expect(calls.binds).toEqual([]);
	});

	it("una sesión del dashboard sigue atando como siempre", async () => {
		await sessionStarted({}, ctx("app", "conv-1"));
		expect(calls.binds).toEqual([["conv-1", "wrun_A"]]);
	});
});
