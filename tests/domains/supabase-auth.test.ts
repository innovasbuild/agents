import { describe, expect, it, vi } from "vitest";
import {
	AuthRedirectError,
	createSupabaseAuthRedirects,
	redirectEntryFor,
	supabaseAuthRedirectsFromEnv,
	syncAuthRedirectUrls,
} from "@/lib/domains/supabase-auth";

function memoryRedirects(
	initial: string[],
	opts: { dropOnWrite?: boolean } = {},
) {
	let list = [...initial];
	const write = vi.fn(async (next: string[]) => {
		if (!opts.dropOnWrite) list = [...next];
	});
	return {
		redirects: { read: async () => [...list], write },
		write,
		current: () => list,
	};
}

describe("redirectEntryFor", () => {
	it("es la URL del callback con el comodín de Supabase", () => {
		expect(redirectEntryFor("ai.okeefe.com.ar")).toBe(
			"https://ai.okeefe.com.ar/auth/callback**",
		);
	});
});

describe("syncAuthRedirectUrls", () => {
	const ROOT = "https://agentes.innov.as/auth/callback**";
	const CONSENT = "https://agentes.innov.as/oauth/consent**";
	const MANUAL = "https://preview.example.com/**";

	it("suma los dominios activos y conserva todo lo que no es suyo", async () => {
		const m = memoryRedirects([ROOT, CONSENT, MANUAL]);
		const out = await syncAuthRedirectUrls(m.redirects, {
			add: ["ai.okeefe.com.ar"],
			remove: [],
		});
		expect(out.changed).toBe(true);
		expect(m.current()).toEqual([
			ROOT,
			CONSENT,
			MANUAL,
			"https://ai.okeefe.com.ar/auth/callback**",
		]);
	});

	it("saca solo la entrada del dominio que se quita", async () => {
		const m = memoryRedirects([
			ROOT,
			"https://ai.okeefe.com.ar/auth/callback**",
			"https://otro.cliente.com/auth/callback**",
			MANUAL,
		]);
		await syncAuthRedirectUrls(m.redirects, {
			add: [],
			remove: ["ai.okeefe.com.ar"],
		});
		expect(m.current()).toEqual([
			ROOT,
			"https://otro.cliente.com/auth/callback**",
			MANUAL,
		]);
	});

	it("es idempotente: sin cambios no escribe", async () => {
		const m = memoryRedirects([
			ROOT,
			"https://ai.okeefe.com.ar/auth/callback**",
		]);
		const out = await syncAuthRedirectUrls(m.redirects, {
			add: ["ai.okeefe.com.ar"],
			remove: [],
		});
		expect(out.changed).toBe(false);
		expect(m.write).not.toHaveBeenCalled();
	});

	it("no duplica una entrada que ya estaba", async () => {
		const entry = "https://ai.okeefe.com.ar/auth/callback**";
		const m = memoryRedirects([entry]);
		await syncAuthRedirectUrls(m.redirects, {
			add: ["ai.okeefe.com.ar", "ai.okeefe.com.ar"],
			remove: [],
		});
		expect(m.current()).toEqual([entry]);
	});

	it("si Supabase no guardó lo pedido, falla en vez de dar por hecho el cambio", async () => {
		const m = memoryRedirects([ROOT], { dropOnWrite: true });
		await expect(
			syncAuthRedirectUrls(m.redirects, {
				add: ["ai.okeefe.com.ar"],
				remove: [],
			}),
		).rejects.toMatchObject({ kind: "unconfirmed" });
	});
});

describe("createSupabaseAuthRedirects", () => {
	function fakeFetch(
		responder: (call: { method: string; body: unknown }) => {
			status: number;
			body?: unknown;
		},
	) {
		const calls: {
			url: string;
			method: string;
			body: unknown;
			auth: string | null;
		}[] = [];
		const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
			const call = {
				url: String(input),
				method: init?.method ?? "GET",
				body: init?.body ? JSON.parse(String(init.body)) : undefined,
				auth: new Headers(init?.headers).get("authorization"),
			};
			calls.push(call);
			const out = responder(call);
			return new Response(
				out.body === undefined ? null : JSON.stringify(out.body),
				{
					status: out.status,
				},
			);
		}) as unknown as typeof fetch;
		return { calls, fetchImpl };
	}

	it("read: GET /v1/projects/{ref}/config/auth y separa por coma", async () => {
		const { calls, fetchImpl } = fakeFetch(() => ({
			status: 200,
			body: { uri_allow_list: "https://a.test/x**, https://b.test/y**,, " },
		}));
		const redirects = createSupabaseAuthRedirects({
			accessToken: "sbp_secret",
			projectRef: "abcdref",
			fetchImpl,
		});
		expect(await redirects.read()).toEqual([
			"https://a.test/x**",
			"https://b.test/y**",
		]);
		expect(calls[0]).toMatchObject({
			url: "https://api.supabase.com/v1/projects/abcdref/config/auth",
			method: "GET",
			auth: "Bearer sbp_secret",
		});
	});

	it("un uri_allow_list vacío o null es una lista vacía", async () => {
		const { fetchImpl } = fakeFetch(() => ({
			status: 200,
			body: { uri_allow_list: null },
		}));
		const redirects = createSupabaseAuthRedirects({
			accessToken: "t",
			projectRef: "abcdefgh",
			fetchImpl,
		});
		expect(await redirects.read()).toEqual([]);
	});

	it("write: PATCH con solo uri_allow_list, separado por comas", async () => {
		const { calls, fetchImpl } = fakeFetch(() => ({ status: 200, body: {} }));
		const redirects = createSupabaseAuthRedirects({
			accessToken: "t",
			projectRef: "abcdefgh",
			fetchImpl,
		});
		await redirects.write(["https://a.test/x**", "https://b.test/y**"]);
		expect(calls[0]).toMatchObject({
			method: "PATCH",
			body: { uri_allow_list: "https://a.test/x**,https://b.test/y**" },
		});
		expect(Object.keys(calls[0]?.body as object)).toEqual(["uri_allow_list"]);
	});

	it.each([
		[401, "unauthorized"],
		[403, "unauthorized"],
		[500, "unavailable"],
	])("el estado %s es %s y no filtra el token", async (status, kind) => {
		const { fetchImpl } = fakeFetch(() => ({ status, body: {} }));
		const redirects = createSupabaseAuthRedirects({
			accessToken: "sbp_secret",
			projectRef: "abcdefgh",
			fetchImpl,
		});
		const error = await redirects.read().catch((e) => e);
		expect(error).toBeInstanceOf(AuthRedirectError);
		expect(error.kind).toBe(kind);
		expect(String(error.message)).not.toContain("sbp_secret");
	});

	it("un projectRef raro no arma otra ruta", () => {
		expect(() =>
			createSupabaseAuthRedirects({
				accessToken: "t",
				projectRef: "../otro",
			}),
		).toThrow();
	});
});

describe("supabaseAuthRedirectsFromEnv", () => {
	it("sin token o sin proyecto no hay adaptador", () => {
		expect(supabaseAuthRedirectsFromEnv({})).toBeNull();
		expect(
			supabaseAuthRedirectsFromEnv({ SUPABASE_ACCESS_TOKEN: "t" }),
		).toBeNull();
	});
	it("con los dos hay adaptador", () => {
		expect(
			supabaseAuthRedirectsFromEnv({
				SUPABASE_ACCESS_TOKEN: "t",
				SUPABASE_PROJECT_REF: "abcdef",
			}),
		).not.toBeNull();
	});
});
