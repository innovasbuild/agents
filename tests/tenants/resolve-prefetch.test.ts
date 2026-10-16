// Value: protects=la lista de agentes arranca junto con el chequeo de acceso sin cambiar su resultado: sin membresía devuelve null, con método no permitido redirige.
// fails_when=el prefetch espera a allowsLogin (no hay paralelismo), o su presencia deja pasar a quien no tiene acceso.
// why_new=resolve.test.ts no mira el orden de las consultas; seam=none
import { describe, expect, it, vi } from "vitest";

const TENANT = {
	id: "t1",
	slug: "demo",
	display_name: "Demo",
	default_model: "m",
	allowed_models: ["m"],
	brand: {},
};

function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((r) => {
		resolve = r;
	});
	return { promise, resolve };
}

async function setup(opts: {
	localRole: string | null;
	prefetch: boolean;
	session?: boolean;
}) {
	const rpcAnswer = deferred<{ data: unknown; error: null }>();
	const rpc = vi.fn(() => rpcAnswer.promise);
	const loadEnabledAgents = vi.fn(async () => ["chat"]);
	vi.resetModules();
	// Fuera de un render `cache` no memoiza: se imita el alcance de un request.
	vi.doMock("react", async (original) => ({
		...(await original<typeof import("react")>()),
		cache: <A extends unknown[], R>(fn: (...args: A) => R) => {
			const seen = new Map<string, R>();
			return (...args: A): R => {
				const key = JSON.stringify(args);
				if (!seen.has(key)) seen.set(key, fn(...args));
				return seen.get(key) as R;
			};
		},
	}));
	vi.doMock("next/navigation", () => ({
		redirect: (url: string) => {
			throw new Error(`NEXT_REDIRECT:${url}`);
		},
	}));
	vi.doMock("@/lib/tenants/enabled-agents", () => ({ loadEnabledAgents }));
	vi.doMock("@/lib/supabase/server", () => ({
		createServerSupabase: async () => ({
			auth: {
				getClaims: async () => ({
					data: opts.session === false ? null : { claims: { sub: "u1" } },
					error: null,
				}),
			},
			rpc,
			from: (table: string) => {
				const builder = {
					select: () => builder,
					eq: () => builder,
					maybeSingle: async () => ({
						data:
							table === "tenants"
								? TENANT
								: opts.localRole
									? { role: opts.localRole }
									: null,
					}),
				};
				return builder;
			},
		}),
	}));
	vi.doMock("@/lib/tenants/platform", () => ({
		platformOwnerAdminTenantId: async () => null,
		platformOwnerSlug: () => "innovas",
	}));
	const resolve = await import("@/lib/tenants/resolve");
	if (opts.prefetch) resolve.prefetchEnabledAgentsWithAccess();
	return {
		access: resolve.resolveTenantAccess("demo"),
		rpc,
		rpcAnswer,
		loadEnabledAgents,
	};
}

describe("resolveTenantAccess · agentes habilitados en paralelo", () => {
	it("pide los agentes mientras allowsLogin sigue pendiente", async () => {
		const run = await setup({ localRole: "tenant_member", prefetch: true });
		await vi.waitFor(() => expect(run.rpc).toHaveBeenCalled());

		// allowsLogin todavía no contestó y la lista ya está en camino.
		expect(run.loadEnabledAgents).toHaveBeenCalledWith("t1");

		run.rpcAnswer.resolve({ data: true, error: null });
		await expect(run.access).resolves.toMatchObject({ id: "t1" });
	});

	it("si el método no está permitido sigue redirigiendo", async () => {
		const run = await setup({ localRole: "tenant_member", prefetch: true });
		await vi.waitFor(() => expect(run.rpc).toHaveBeenCalled());
		run.rpcAnswer.resolve({ data: false, error: null });

		await expect(run.access).rejects.toThrow("NEXT_REDIRECT:/login/demo");
	});

	it("sin membresía sigue siendo null, sin llegar a allowsLogin", async () => {
		const run = await setup({ localRole: null, prefetch: true });

		await expect(run.access).resolves.toBeNull();
		expect(run.rpc).not.toHaveBeenCalled();
	});

	it("sin sesión no lee nada de agentes", async () => {
		const run = await setup({
			localRole: "tenant_member",
			prefetch: true,
			session: false,
		});

		await expect(run.access).resolves.toBeNull();
		expect(run.loadEnabledAgents).not.toHaveBeenCalled();
	});

	it("sin el pedido del layout no se lee la lista", async () => {
		const run = await setup({ localRole: "tenant_member", prefetch: false });
		run.rpcAnswer.resolve({ data: true, error: null });

		await expect(run.access).resolves.toMatchObject({ id: "t1" });
		expect(run.loadEnabledAgents).not.toHaveBeenCalled();
	});
});
