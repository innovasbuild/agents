import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
	hasBinding: true,
	serviceError: null as Error | null,
	requireAuthCalls: 0,
	serviceInput: null as unknown,
	connectScopes: null as string[] | undefined | null,
}));

vi.mock("../../lib/connectors/bindings", () => ({
	hasEnabledBinding: async () => state.hasBinding,
}));
vi.mock("../../lib/connectors/auth", () => ({
	tenantScopedConnect: (
		connector: string,
		tenantId: string,
		scopes?: string[],
	) => {
		state.connectScopes = scopes;
		return { connector, tenantId, scopes };
	},
}));
vi.mock("../../lib/outreach/crm-session", () => ({
	crmForSession: async () => null,
}));
vi.mock("../../lib/outreach/canon", () => ({
	brainForTenant: async () => null,
	loadCanon: async () => ({}),
}));
vi.mock("../../lib/supabase/admin", () => ({ createAdminClient: () => ({}) }));
vi.mock("eve/tools/approval", () => ({
	always: () => "always",
	once: () => "once",
	never: () => "never",
}));
vi.mock("../../lib/outreach/services/send", () => ({
	sendQueuedEmail: async (input: unknown) => {
		state.serviceInput = input;
		if (state.serviceError) throw state.serviceError;
		return { ok: true };
	},
}));

const { default: tool } = await import("@/agents/outreach/tools/send_email");
const { GmailUnauthorizedError, GMAIL_SCOPES } = await import(
	"@/lib/gmail/send"
);

const context = {
	callId: "call-1",
	session: {
		id: "wrun_1",
		auth: {
			current: {
				principalType: "user",
				principalId: "user-1",
				attributes: { tenantId: "tenant-a", email: "ana@innov.test" },
			},
			initiator: null,
		},
	},
	getToken: async () => ({ token: "tok" }),
	requireAuth: () => {
		state.requireAuthCalls += 1;
		throw new Error("auth requerida");
	},
};
const input = {
	queueItemId: "5b3c7a0e-2f4d-4c1a-9f7e-1d2c3b4a5e6f",
	to: "a@b.test",
	subject: "Hola",
	body: "Cuerpo",
};
// biome-ignore lint/suspicious/noExplicitAny: el ctx de eve se simula parcialmente.
const run = () => (tool as any).execute(input, context);

beforeEach(() => {
	state.hasBinding = true;
	state.serviceError = null;
	state.requireAuthCalls = 0;
	state.serviceInput = null;
	state.connectScopes = null;
});

describe("send_email", () => {
	it("pide aprobación siempre (always, no once ni never)", () => {
		// biome-ignore lint/suspicious/noExplicitAny: inspección de la definición.
		expect((tool as any).approval).toBe("always");
	});

	it("pasa al servicio la pieza, la sesión y el callId", async () => {
		expect(await run()).toEqual({ ok: true });
		expect(state.serviceInput).toMatchObject({
			queueItemId: input.queueItemId,
			sessionId: "wrun_1",
			callId: "call-1",
			caller: { tenantId: "tenant-a", userId: "user-1" },
		});
	});

	it("sin Gmail habilitado devuelve una negativa", async () => {
		state.hasBinding = false;
		expect(await run()).toMatchObject({ ok: false, reason: "sin_gmail" });
	});

	it("un 401 de Gmail pide autorización", async () => {
		state.serviceError = new GmailUnauthorizedError();
		await expect(run()).rejects.toThrow("auth requerida");
		expect(state.requireAuthCalls).toBe(1);
	});

	it("pide el token con el mismo conjunto de scopes de GMAIL_SCOPES (send + readonly), no solo send", async () => {
		await run();
		expect(state.connectScopes).toEqual([...GMAIL_SCOPES]);
		expect(state.connectScopes).toContain(
			"https://www.googleapis.com/auth/gmail.send",
		);
		expect(state.connectScopes).toContain(
			"https://www.googleapis.com/auth/gmail.readonly",
		);
	});
});
