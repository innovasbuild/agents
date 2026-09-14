import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
	hasBinding: true,
	sendError: null as Error | null,
	getTokenCalls: [] as unknown[][],
	requireAuthCalls: 0,
}));

vi.mock("../../lib/connectors/bindings", () => ({
	hasEnabledBinding: async () => state.hasBinding,
}));
vi.mock("../../lib/connectors/auth", () => ({
	tenantScopedConnect: (
		connector: string,
		tenantId: string,
		scopes: string[],
	) => ({ connector, tenantId, scopes }),
}));
vi.mock("../../lib/gmail/send", async (importOriginal) => {
	const original = await importOriginal<typeof import("@/lib/gmail/send")>();
	return {
		...original,
		sendMail: async () => {
			if (state.sendError) throw state.sendError;
			return { id: "m1", threadId: "t1" };
		},
	};
});

const { default: tool } = await import("@/agents/outreach/tools/send_email");
const { GmailUnauthorizedError, GMAIL_SEND_SCOPE } = await import(
	"@/lib/gmail/send"
);

const context = {
	session: {
		auth: {
			current: {
				principalType: "user",
				principalId: "user-1",
				attributes: { tenantId: "tenant-a" },
			},
		},
	},
	getToken: async (...args: unknown[]) => {
		state.getTokenCalls.push(args);
		return { token: "tok" };
	},
	requireAuth: () => {
		state.requireAuthCalls += 1;
		throw new Error("auth requerida");
	},
};
const input = { to: "a@b.test", subject: "Hola", body: "Cuerpo" };
// biome-ignore lint/suspicious/noExplicitAny: el ctx de eve se simula parcialmente.
const run = () => (tool as any).execute(input, context);

beforeEach(() => {
	state.hasBinding = true;
	state.sendError = null;
	state.getTokenCalls = [];
	state.requireAuthCalls = 0;
});

describe("send_email", () => {
	it("pide el token de Gmail atado al tenant con authKey gmail", async () => {
		expect(await run()).toEqual({ id: "m1", threadId: "t1" });
		const [provider, options] = state.getTokenCalls[0] as [
			{ tenantId: string; scopes: string[] },
			{ authKey: string },
		];
		expect(provider.tenantId).toBe("tenant-a");
		expect(provider.scopes).toEqual([GMAIL_SEND_SCOPE]);
		expect(options.authKey).toBe("gmail");
	});

	it("rechaza un tenant sin Gmail habilitado", async () => {
		state.hasBinding = false;
		await expect(run()).rejects.toThrow(/Gmail/);
	});

	it("un 401 dispara requireAuth", async () => {
		state.sendError = new GmailUnauthorizedError();
		await expect(run()).rejects.toThrow();
		expect(state.requireAuthCalls).toBe(1);
	});
});
