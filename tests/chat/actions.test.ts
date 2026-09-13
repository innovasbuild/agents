import { beforeEach, describe, expect, it, vi } from "vitest";

const calls = vi.hoisted(() => ({
	updates: [] as unknown[],
	eqArgs: [] as unknown[][],
	revalidated: [] as string[],
}));

const auth = vi.hoisted(() => ({
	user: null as { id: string } | null,
}));

vi.mock("next/cache", () => ({
	revalidatePath: (path: string) => {
		calls.revalidated.push(path);
	},
}));

// persistSessionId ya no escribe eve_session_id con el cliente de sesión
// (conversations_update dejó de permitirlo, fix de la revisión final para
// C1): ahora solo lo usa para saber quién es el caller.
vi.mock("@/lib/supabase/server", () => ({
	createServerSupabase: async () => ({
		auth: {
			getUser: async () => ({ data: { user: auth.user } }),
		},
	}),
}));

// El cliente admin bypassea RLS, así que el ownership check tiene que ir acá
// mismo, explícito en la query: por eso el mock encadena DOS .eq() (id y
// user_id) y el test verifica ambos.
vi.mock("@/lib/supabase/admin", () => ({
	createAdminClient: () => ({
		from: () => ({
			update(values: unknown) {
				calls.updates.push(values);
				const builder = {
					eq(...args: unknown[]) {
						calls.eqArgs.push(args);
						return builder;
					},
				};
				return builder;
			},
		}),
	}),
}));

const { persistSessionId } = await import("@/app/[tenant]/chat/actions");

beforeEach(() => {
	calls.updates = [];
	calls.eqArgs = [];
	calls.revalidated = [];
	auth.user = { id: "user-1" };
});

describe("persistSessionId", () => {
	it("guarda el eve_session_id de la conversación propia, con ownership explícito en la query", async () => {
		await persistSessionId("conv-1", "wrun_A", "acme");

		expect(calls.updates[0]).toMatchObject({ eve_session_id: "wrun_A" });
		expect(calls.eqArgs[0]).toEqual(["id", "conv-1"]);
		expect(calls.eqArgs[1]).toEqual(["user_id", "user-1"]);
	});

	it("revalida la ruta del chat del tenant para que un remount concurrente vea el id", async () => {
		await persistSessionId("conv-1", "wrun_A", "acme");

		expect(calls.revalidated).toEqual(["/acme/chat"]);
	});

	it("no escribe nada si no hay sesión (el admin bypassea RLS, así que este chequeo es la única puerta)", async () => {
		auth.user = null;

		await persistSessionId("conv-1", "wrun_A", "acme");

		expect(calls.updates).toEqual([]);
		expect(calls.revalidated).toEqual([]);
	});
});
