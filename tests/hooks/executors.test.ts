import { beforeEach, describe, expect, it, vi } from "vitest";

const calls = vi.hoisted(() => ({ marks: [] as string[][], fail: false }));

vi.mock("../../lib/connectors/executors", () => ({
	markGmailAuthorized: async (tenantId: string, userId: string) => {
		if (calls.fail) throw new Error("base caída");
		calls.marks.push([tenantId, userId]);
	},
}));

const { default: hook } = await import("@/agents/outreach/hooks/executors");
// biome-ignore lint/suspicious/noExplicitAny: evento y ctx de eve simulados.
const handler = (hook as any).events["authorization.completed"];

const ctx = {
	session: {
		auth: {
			current: {
				principalType: "user",
				principalId: "user-1",
				attributes: { tenantId: "tenant-a" },
			},
		},
	},
};

beforeEach(() => {
	calls.marks = [];
	calls.fail = false;
});

describe("hook de ejecutores", () => {
	it("estampa la autorización de Gmail", async () => {
		await handler({ data: { name: "gmail", outcome: "authorized" } }, ctx);
		expect(calls.marks).toEqual([["tenant-a", "user-1"]]);
	});

	it("ignora otras autorizaciones y resultados", async () => {
		await handler({ data: { name: "hubspot", outcome: "authorized" } }, ctx);
		await handler({ data: { name: "gmail", outcome: "declined" } }, ctx);
		expect(calls.marks).toEqual([]);
	});

	it("nunca tira: la observabilidad no tumba el turno", async () => {
		calls.fail = true;
		await expect(
			handler({ data: { name: "gmail", outcome: "authorized" } }, ctx),
		).resolves.toBeUndefined();
	});
});
