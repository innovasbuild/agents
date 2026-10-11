import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	actionAllowsLogin,
	consentAllowsLogin,
} from "@/lib/tenants/login-check-server";
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

/**
 * `ownerRow`: la membresía platform_admin en el tenant dueño, si la hay.
 * `tenants`: las empresas activas de la persona.
 */
function fakeConsentSupabase(options: {
	ownerRow: unknown;
	tenants?: string[];
	listError?: unknown;
	allowed?: (tenantId: string) => boolean | Error;
}) {
	const rpcCalls: [string, unknown][] = [];
	const list = Promise.resolve({
		data: (options.tenants ?? []).map((id) => ({ tenant_id: id })),
		error: options.listError ?? null,
	});
	const builder = Object.assign(list, {
		select: () => builder,
		eq: () => builder,
		maybeSingle: async () => ({ data: options.ownerRow, error: null }),
	});
	const client = {
		from: () => builder,
		rpc: async (fn: string, args: { p_tenant: string }) => {
			rpcCalls.push([fn, args]);
			const answer = options.allowed ? options.allowed(args.p_tenant) : true;
			if (answer instanceof Error) throw answer;
			return { data: answer as unknown, error: null as unknown };
		},
	};
	return { client: client as unknown as ServerSupabase, rpcCalls };
}

describe("consentAllowsLogin", () => {
	const original = process.env.PLATFORM_OWNER_TENANT_SLUG;
	beforeEach(() => {
		process.env.PLATFORM_OWNER_TENANT_SLUG = "innovas";
	});
	afterEach(() => {
		if (original === undefined) delete process.env.PLATFORM_OWNER_TENANT_SLUG;
		else process.env.PLATFORM_OWNER_TENANT_SLUG = original;
		vi.restoreAllMocks();
	});

	it("deja autorizar si todas las empresas de la persona permiten el método", async () => {
		const { client, rpcCalls } = fakeConsentSupabase({
			ownerRow: null,
			tenants: [TENANT_ID, OWNER_ID],
		});
		expect(await consentAllowsLogin(client, USER_ID)).toBe(true);
		expect(rpcCalls).toEqual([
			["tenant_allows_login", { p_tenant: TENANT_ID }],
			["tenant_allows_login", { p_tenant: OWNER_ID }],
		]);
	});

	it("si una de sus empresas no permite el método, no deja: el grant vale para todas", async () => {
		const { client } = fakeConsentSupabase({
			ownerRow: null,
			tenants: [TENANT_ID, OWNER_ID],
			allowed: (id) => id !== TENANT_ID,
		});
		expect(await consentAllowsLogin(client, USER_ID)).toBe(false);
	});

	it("a un administrador de plataforma lo chequea solo contra el tenant dueño (L12)", async () => {
		const { client, rpcCalls } = fakeConsentSupabase({
			ownerRow: { tenant_id: OWNER_ID },
			tenants: [TENANT_ID, OWNER_ID],
			allowed: (id) => id === OWNER_ID,
		});
		expect(await consentAllowsLogin(client, USER_ID)).toBe(true);
		expect(rpcCalls).toEqual([["tenant_allows_login", { p_tenant: OWNER_ID }]]);
	});

	it("si el RPC tira o no se pueden leer sus empresas, no deja", async () => {
		vi.spyOn(console, "error").mockImplementation(() => {});
		const tira = fakeConsentSupabase({
			ownerRow: null,
			tenants: [TENANT_ID],
			allowed: () => new Error("red"),
		});
		expect(await consentAllowsLogin(tira.client, USER_ID)).toBe(false);
		const sinLista = fakeConsentSupabase({
			ownerRow: null,
			listError: { message: "boom" },
		});
		expect(await consentAllowsLogin(sinLista.client, USER_ID)).toBe(false);
	});

	it("sin empresas activas no hay nada que autorizar", async () => {
		const { client } = fakeConsentSupabase({ ownerRow: null, tenants: [] });
		expect(await consentAllowsLogin(client, USER_ID)).toBe(false);
	});
});
