import { describe, expect, it, vi } from "vitest";
import {
	createVercelDomains,
	VercelApiError,
	vercelDomainsFromEnv,
} from "@/lib/domains/vercel";

type Call = { url: string; method: string; body: unknown; auth: string | null };

function fakeFetch(
	responder: (call: Call) => { status: number; body?: unknown } | Error,
) {
	const calls: Call[] = [];
	const fetchImpl = vi.fn(
		async (input: RequestInfo | URL, init?: RequestInit) => {
			const call: Call = {
				url: String(input),
				method: init?.method ?? "GET",
				body: init?.body ? JSON.parse(String(init.body)) : undefined,
				auth: new Headers(init?.headers).get("authorization"),
			};
			calls.push(call);
			const out = responder(call);
			if (out instanceof Error) throw out;
			return new Response(
				out.body === undefined ? null : JSON.stringify(out.body),
				{
					status: out.status,
					headers: { "content-type": "application/json" },
				},
			);
		},
	) as unknown as typeof fetch;
	return { calls, fetchImpl };
}

const api = (fetchImpl: typeof fetch, teamId: string | null = "team_1") =>
	createVercelDomains({
		token: "tok_secret",
		projectId: "prj_1",
		teamId: teamId ?? undefined,
		fetchImpl,
	});

const DOMAIN = {
	name: "ai.okeefe.com.ar",
	apexName: "okeefe.com.ar",
	projectId: "prj_1",
	verified: true,
};

describe("add", () => {
	it("POST /v10/projects/{id}/domains con el team y el bearer", async () => {
		const { calls, fetchImpl } = fakeFetch(() => ({
			status: 200,
			body: DOMAIN,
		}));
		const result = await api(fetchImpl).add("ai.okeefe.com.ar");

		expect(calls).toHaveLength(1);
		expect(calls[0]).toMatchObject({
			url: "https://api.vercel.com/v10/projects/prj_1/domains?teamId=team_1",
			method: "POST",
			body: { name: "ai.okeefe.com.ar" },
			auth: "Bearer tok_secret",
		});
		expect(result).toEqual({
			name: "ai.okeefe.com.ar",
			verified: true,
			verification: [],
		});
	});

	it("sin team no manda teamId", async () => {
		const { calls, fetchImpl } = fakeFetch(() => ({
			status: 200,
			body: DOMAIN,
		}));
		await api(fetchImpl, null).add("ai.okeefe.com.ar");
		expect(calls[0]?.url).toBe(
			"https://api.vercel.com/v10/projects/prj_1/domains",
		);
	});

	it("devuelve el desafío TXT cuando el dominio no está verificado", async () => {
		const { fetchImpl } = fakeFetch(() => ({
			status: 200,
			body: {
				...DOMAIN,
				verified: false,
				verification: [
					{
						type: "TXT",
						domain: "_vercel.okeefe.com.ar",
						value: "vc-domain-verify=abc",
						reason: "pending_domain_verification",
					},
				],
			},
		}));
		const result = await api(fetchImpl).add("ai.okeefe.com.ar");
		expect(result.verified).toBe(false);
		expect(result.verification).toEqual([
			{
				type: "TXT",
				domain: "_vercel.okeefe.com.ar",
				value: "vc-domain-verify=abc",
				reason: "pending_domain_verification",
			},
		]);
	});

	it("409 es un dominio que ya está en otro proyecto", async () => {
		const { fetchImpl } = fakeFetch(() => ({
			status: 409,
			body: { error: { code: "domain_already_in_use", message: "ya existe" } },
		}));
		await expect(api(fetchImpl).add("ai.okeefe.com.ar")).rejects.toMatchObject({
			kind: "in_use",
		});
	});

	it("400 porque ya estaba en este proyecto es idempotente: devuelve el existente", async () => {
		const { calls, fetchImpl } = fakeFetch((call) =>
			call.method === "POST"
				? {
						status: 400,
						body: { error: { code: "bad_request", message: "x" } },
					}
				: { status: 200, body: DOMAIN },
		);
		const result = await api(fetchImpl).add("ai.okeefe.com.ar");
		expect(result.name).toBe("ai.okeefe.com.ar");
		expect(calls.map((c) => c.method)).toEqual(["POST", "GET"]);
	});

	it("400 y el dominio no está en el proyecto es un dominio inválido", async () => {
		const { fetchImpl } = fakeFetch((call) =>
			call.method === "POST"
				? {
						status: 400,
						body: { error: { code: "invalid_domain", message: "x" } },
					}
				: { status: 404 },
		);
		await expect(api(fetchImpl).add("ai.okeefe.com.ar")).rejects.toMatchObject({
			kind: "invalid",
		});
	});

	it.each([
		[401, "unauthorized"],
		[403, "unauthorized"],
		[402, "payment"],
		[429, "rate_limit"],
		[500, "unavailable"],
		[503, "unavailable"],
	])("el estado %s es %s", async (status, kind) => {
		const { fetchImpl } = fakeFetch(() => ({ status, body: {} }));
		await expect(api(fetchImpl).add("ai.okeefe.com.ar")).rejects.toMatchObject({
			kind,
		});
	});

	it("un corte de red es unavailable", async () => {
		const { fetchImpl } = fakeFetch(() => new Error("ECONNRESET"));
		await expect(api(fetchImpl).add("ai.okeefe.com.ar")).rejects.toMatchObject({
			kind: "unavailable",
		});
	});

	it("el error no filtra el token", async () => {
		const { fetchImpl } = fakeFetch(() => ({ status: 401, body: {} }));
		const error = await api(fetchImpl)
			.add("ai.okeefe.com.ar")
			.catch((e) => e);
		expect(error).toBeInstanceOf(VercelApiError);
		expect(JSON.stringify(error) + String(error.message)).not.toContain(
			"tok_secret",
		);
	});
});

describe("get / verify / remove / config", () => {
	it("get: GET /v9/projects/{id}/domains/{domain}; 404 es null", async () => {
		const { calls, fetchImpl } = fakeFetch(() => ({ status: 404 }));
		expect(await api(fetchImpl).get("ai.okeefe.com.ar")).toBeNull();
		expect(calls[0]).toMatchObject({
			url: "https://api.vercel.com/v9/projects/prj_1/domains/ai.okeefe.com.ar?teamId=team_1",
			method: "GET",
		});
	});

	it("verify: POST .../verify; 400 (todavía sin TXT) devuelve el estado actual sin verificar", async () => {
		const { calls, fetchImpl } = fakeFetch((call) =>
			call.method === "POST"
				? { status: 400, body: { error: { code: "missing_txt_record" } } }
				: { status: 200, body: { ...DOMAIN, verified: false } },
		);
		const result = await api(fetchImpl).verify("ai.okeefe.com.ar");
		expect(result.verified).toBe(false);
		expect(calls[0]?.url).toBe(
			"https://api.vercel.com/v9/projects/prj_1/domains/ai.okeefe.com.ar/verify?teamId=team_1",
		);
	});

	it("remove: DELETE; 404 no es error", async () => {
		const { calls, fetchImpl } = fakeFetch(() => ({ status: 404 }));
		await expect(
			api(fetchImpl).remove("ai.okeefe.com.ar"),
		).resolves.toBeUndefined();
		expect(calls[0]).toMatchObject({
			url: "https://api.vercel.com/v9/projects/prj_1/domains/ai.okeefe.com.ar?teamId=team_1",
			method: "DELETE",
		});
	});

	it("config: toma el CNAME de rank más bajo y lee misconfigured", async () => {
		const { calls, fetchImpl } = fakeFetch(() => ({
			status: 200,
			body: {
				configuredBy: null,
				misconfigured: true,
				acceptedChallenges: [],
				recommendedIPv4: [],
				recommendedCNAME: [
					{ rank: 2, value: "segundo.vercel-dns.com." },
					{ rank: 1, value: "uno.vercel-dns.com." },
				],
			},
		}));
		const result = await api(fetchImpl).config("ai.okeefe.com.ar");
		expect(result).toEqual({
			configuredBy: null,
			misconfigured: true,
			recommendedCname: "uno.vercel-dns.com.",
		});
		expect(calls[0]?.url).toBe(
			"https://api.vercel.com/v6/domains/ai.okeefe.com.ar/config?projectIdOrName=prj_1&teamId=team_1",
		);
	});

	it("un hostname con caracteres raros no arma una ruta distinta", async () => {
		const { fetchImpl } = fakeFetch(() => ({ status: 404 }));
		await expect(api(fetchImpl).get("a/../../otro")).rejects.toMatchObject({
			kind: "invalid",
		});
	});
});

describe("vercelDomainsFromEnv", () => {
	it("sin token o sin proyecto no hay adaptador", () => {
		expect(vercelDomainsFromEnv({})).toBeNull();
		expect(vercelDomainsFromEnv({ VERCEL_API_TOKEN: "t" })).toBeNull();
		expect(vercelDomainsFromEnv({ VERCEL_PROJECT_ID: "p" })).toBeNull();
	});

	it("con token y proyecto hay adaptador; el team es opcional", () => {
		expect(
			vercelDomainsFromEnv({ VERCEL_API_TOKEN: "t", VERCEL_PROJECT_ID: "p" }),
		).not.toBeNull();
	});
});
