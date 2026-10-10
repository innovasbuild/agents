import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
	metadata: null as Record<string, unknown> | null,
	error: null as Error | null,
	calls: [] as string[],
}));

vi.mock("@vercel/connect", () => {
	class ConnectError extends Error {
		status?: number;
		constructor(message: string, options?: { status?: number }) {
			super(message);
			this.status = options?.status;
		}
	}
	return {
		ConnectError,
		NoValidTokenError: class extends ConnectError {},
		UserAuthorizationRequiredError: class extends ConnectError {},
		ConnectorInstallationRequiredError: class extends ConnectError {},
		getToken: async () => "t",
		getTokenResponse: async () => ({ token: "t", expiresAt: 0 }),
		startAuthorization: async () => ({ url: "u", expiresAt: null }),
		getConnectorMetadata: async (uid: string) => {
			state.calls.push(uid);
			if (state.error) throw state.error;
			return state.metadata;
		},
	};
});
vi.mock("@vercel/connect/eve", () => ({ connect: () => ({}) }));

const connect = await import("@vercel/connect");
const { describeConnector } = await import("@/lib/connectors/auth");

describe("describeConnector", () => {
	beforeEach(() => {
		state.metadata = { name: "Acme ColdIQ", service: "coldiq", uid: "x" };
		state.error = null;
		state.calls = [];
	});

	it("devuelve nombre y servicio del conector", async () => {
		expect(await describeConnector("acme-coldiq")).toEqual({
			name: "Acme ColdIQ",
			service: "coldiq",
		});
		expect(state.calls).toEqual(["acme-coldiq"]);
	});

	it.each([404, 403])("si Vercel responde %s, el conector no está: null", async (status) => {
		state.error = new connect.ConnectError("no", { status });
		expect(await describeConnector("x")).toBeNull();
	});

	it("cualquier otro error se propaga", async () => {
		state.error = new connect.ConnectError("boom", { status: 500 });
		await expect(describeConnector("x")).rejects.toThrow("boom");

		state.error = new Error("sin OIDC");
		await expect(describeConnector("x")).rejects.toThrow("sin OIDC");
	});
});
