import { beforeEach, describe, expect, it, vi } from "vitest";

const calls = vi.hoisted(() => ({ opens: [] as unknown[] }));

vi.mock("../../lib/agents/session-store", () => ({
	openRun: async (input: unknown) => {
		calls.opens.push(input);
	},
	closeRun: async () => {},
}));

const { default: hook } = await import("@/agents/outreach/hooks/runs");
// biome-ignore lint/suspicious/noExplicitAny: evento y ctx de eve simulados.
const turnStarted = (hook as any).events["turn.started"];

function ctx(authenticator: string | undefined) {
	return {
		agent: { name: "outreach" },
		session: {
			id: "wrun_A",
			auth: {
				current: {
					authenticator,
					attributes: { tenantId: "tenant-1" },
				},
			},
		},
	};
}

beforeEach(() => {
	calls.opens = [];
});

describe("hook de runs — trigger", () => {
	it("authenticator oauth abre el run con trigger mcp", async () => {
		await turnStarted({ data: { turnId: "turn-1" } }, ctx("oauth"));
		expect(calls.opens).toEqual([expect.objectContaining({ trigger: "mcp" })]);
	});

	it("authenticator app abre el run con trigger chat", async () => {
		await turnStarted({ data: { turnId: "turn-1" } }, ctx("app"));
		expect(calls.opens).toEqual([expect.objectContaining({ trigger: "chat" })]);
	});

	it("sin authenticator, trigger chat", async () => {
		await turnStarted({ data: { turnId: "turn-1" } }, ctx(undefined));
		expect(calls.opens).toEqual([expect.objectContaining({ trigger: "chat" })]);
	});
});
