import { beforeEach, describe, expect, it, vi } from "vitest";

const calls = vi.hoisted(() => ({
	updates: [] as unknown[],
	eqArgs: [] as unknown[],
	revalidated: [] as string[],
}));

vi.mock("next/cache", () => ({
	revalidatePath: (path: string) => {
		calls.revalidated.push(path);
	},
}));

vi.mock("@/lib/supabase/server", () => ({
	createServerSupabase: async () => ({
		from: () => ({
			update(values: unknown) {
				calls.updates.push(values);
				return {
					eq(...args: unknown[]) {
						calls.eqArgs.push(args);
						return Promise.resolve({ error: null });
					},
				};
			},
		}),
	}),
}));

const { persistSessionId } = await import("@/app/[tenant]/chat/actions");

beforeEach(() => {
	calls.updates = [];
	calls.eqArgs = [];
	calls.revalidated = [];
});

describe("persistSessionId", () => {
	it("guarda el eve_session_id de la conversación", async () => {
		await persistSessionId("conv-1", "wrun_A", "acme");

		expect(calls.updates[0]).toMatchObject({ eve_session_id: "wrun_A" });
		expect(calls.eqArgs[0]).toEqual(["id", "conv-1"]);
	});

	it("revalida la ruta del chat del tenant para que un remount concurrente vea el id", async () => {
		await persistSessionId("conv-1", "wrun_A", "acme");

		expect(calls.revalidated).toEqual(["/acme/chat"]);
	});
});
