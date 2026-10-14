import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
	config: null as null | { auth: Array<(r: Request) => Promise<unknown>> },
	resolve: vi.fn(),
}));

vi.mock("eve/channels/eve", () => ({
	eveChannel: (config: typeof state.config) => {
		state.config = config;
		return config;
	},
}));
vi.mock("@/lib/auth/verify-caller", () => ({
	verifyCaller: async () => ({
		userId: "u1",
		email: "u@acme.test",
		allowsLogin: true,
	}),
}));
vi.mock("@/lib/agents/channel-context", () => ({
	resolveChannelContext: state.resolve,
}));

import { webChannel } from "@/lib/agents/eve/web-channel";

describe("webChannel", () => {
	beforeEach(() => {
		state.resolve.mockReset();
		state.resolve.mockResolvedValue(null);
	});

	it.each(["asistente", "outreach"])(
		"le reenvía a resolveChannelContext el agente %s",
		async (agent) => {
			webChannel(agent);

			await state.config?.auth[0](
				new Request("http://localhost/eve/x/v1/info"),
			);

			expect(state.resolve).toHaveBeenCalledWith(
				expect.any(Request),
				"u1",
				true,
				agent,
			);
		},
	);
});
