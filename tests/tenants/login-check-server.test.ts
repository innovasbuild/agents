import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { actionAllowsLogin } from "@/lib/tenants/login-check-server";
import type { ServerSupabase } from "@/lib/tenants/platform";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const TENANT_ID = "22222222-2222-4222-8222-222222222222";
const OWNER_ID = "99999999-9999-4999-8999-999999999999";

/** `ownerRow`: la membresía platform_admin en el tenant dueño, si la hay. */
function fakeSupabase(options: {
	ownerRow: unknown;
	rpc?: () => Promise<{ data: unknown; error: unknown }>;
	membershipThrows?: boolean;
}) {
	const rpcCalls: [string, unknown][] = [];
	const builder = {
		select: () => builder,
		eq: () => builder,
		maybeSingle: async () => {
			if (options.membershipThrows) throw new Error("red");
			return { data: options.ownerRow, error: null };
		},
	};
	const client = {
		from: () => builder,
		rpc: async (fn: string, args: unknown) => {
			rpcCalls.push([fn, args]);
			return options.rpc
				? options.rpc()
				: { data: true as unknown, error: null as unknown };
		},
	};
	return { client: client as unknown as ServerSupabase, rpcCalls };
}

describe("actionAllowsLogin", () => {
	const original = process.env.PLATFORM_OWNER_TENANT_SLUG;
	beforeEach(() => {
		process.env.PLATFORM_OWNER_TENANT_SLUG = "innovas";
	});
	afterEach(() => {
		if (original === undefined) delete process.env.PLATFORM_OWNER_TENANT_SLUG;
		else process.env.PLATFORM_OWNER_TENANT_SLUG = original;
		vi.restoreAllMocks();
	});

	it("a un miembro lo chequea contra la empresa de la acción", async () => {
		const { client, rpcCalls } = fakeSupabase({ ownerRow: null });

		expect(await actionAllowsLogin(client, USER_ID, TENANT_ID)).toBe(true);
		expect(rpcCalls).toEqual([
			["tenant_allows_login", { p_tenant: TENANT_ID }],
		]);
	});

	it("a un administrador de plataforma lo chequea contra el tenant dueño (L12)", async () => {
		const { client, rpcCalls } = fakeSupabase({
			ownerRow: { tenant_id: OWNER_ID },
		});

		expect(await actionAllowsLogin(client, USER_ID, TENANT_ID)).toBe(true);
		expect(rpcCalls).toEqual([["tenant_allows_login", { p_tenant: OWNER_ID }]]);
	});

	it("si la base dice que no, es falso", async () => {
		const { client } = fakeSupabase({
			ownerRow: null,
			rpc: async () => ({ data: false, error: null }),
		});

		expect(await actionAllowsLogin(client, USER_ID, TENANT_ID)).toBe(false);
	});

	it("si el RPC devuelve error, es falso", async () => {
		vi.spyOn(console, "error").mockImplementation(() => {});
		const { client } = fakeSupabase({
			ownerRow: null,
			rpc: async () => ({ data: true, error: { message: "boom" } }),
		});

		expect(await actionAllowsLogin(client, USER_ID, TENANT_ID)).toBe(false);
	});

	it("si el RPC tira, es falso", async () => {
		vi.spyOn(console, "error").mockImplementation(() => {});
		const { client } = fakeSupabase({
			ownerRow: null,
			rpc: async () => {
				throw new Error("red");
			},
		});

		expect(await actionAllowsLogin(client, USER_ID, TENANT_ID)).toBe(false);
	});

	it("si no se puede saber si es de plataforma, es falso y no tira", async () => {
		const error = vi.spyOn(console, "error").mockImplementation(() => {});
		const { client, rpcCalls } = fakeSupabase({
			ownerRow: null,
			membershipThrows: true,
		});

		expect(await actionAllowsLogin(client, USER_ID, TENANT_ID)).toBe(false);
		expect(rpcCalls).toHaveLength(0);
		expect(error).toHaveBeenCalled();
	});
});
