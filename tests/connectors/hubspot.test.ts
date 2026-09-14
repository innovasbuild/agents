import { describe, expect, it } from "vitest";
import {
	ensureOutreachProperties,
	HubSpotUnauthorizedError,
	OUTREACH_PROPERTIES,
} from "@/lib/connectors/crm/hubspot";

type Call = { url: string; method: string; body: unknown; auth: string | null };

function fakeHubSpot(options: {
	existing: string[];
	groupExists: boolean;
	status?: number;
}) {
	const calls: Call[] = [];
	const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
		const url = String(input);
		const method = init?.method ?? "GET";
		const headers = new Headers(init?.headers);
		calls.push({
			url,
			method,
			body: init?.body ? JSON.parse(String(init.body)) : null,
			auth: headers.get("authorization"),
		});
		if (options.status) return new Response("{}", { status: options.status });
		if (method === "GET" && url.endsWith("/groups/outreach")) {
			return new Response("{}", { status: options.groupExists ? 200 : 404 });
		}
		if (method === "GET" && url.endsWith("/crm/v3/properties/contacts")) {
			return Response.json({
				results: options.existing.map((name) => ({ name })),
			});
		}
		return Response.json({}, { status: 201 });
	}) as typeof fetch;
	return { calls, fetchImpl };
}

describe("ensureOutreachProperties", () => {
	it("crea el grupo y las 10 propiedades en un HubSpot vacío", async () => {
		const { calls, fetchImpl } = fakeHubSpot({
			existing: [],
			groupExists: false,
		});
		const result = await ensureOutreachProperties("tok", fetchImpl);
		expect(result.created).toHaveLength(10);
		expect(
			calls.some(
				(c) =>
					c.method === "POST" &&
					c.url.endsWith("/crm/v3/properties/contacts/groups"),
			),
		).toBe(true);
		expect(calls.every((c) => c.auth === "Bearer tok")).toBe(true);
	});

	it("es idempotente: no crea lo que ya existe", async () => {
		const names = OUTREACH_PROPERTIES.map((p) => p.name);
		const { calls, fetchImpl } = fakeHubSpot({
			existing: names,
			groupExists: true,
		});
		const result = await ensureOutreachProperties("tok", fetchImpl);
		expect(result).toEqual({ created: [], existing: names });
		expect(calls.filter((c) => c.method === "POST")).toHaveLength(0);
	});

	it("crea solo las faltantes, dentro del grupo outreach", async () => {
		const { calls, fetchImpl } = fakeHubSpot({
			existing: ["contact_key"],
			groupExists: true,
		});
		const result = await ensureOutreachProperties("tok", fetchImpl);
		expect(result.created).not.toContain("contact_key");
		expect(result.created).toHaveLength(9);
		const posts = calls.filter((c) => c.method === "POST");
		expect(
			posts.every(
				(c) => (c.body as { groupName: string }).groupName === "outreach",
			),
		).toBe(true);
	});

	it("un 401 se traduce a HubSpotUnauthorizedError", async () => {
		const { fetchImpl } = fakeHubSpot({
			existing: [],
			groupExists: true,
			status: 401,
		});
		await expect(
			ensureOutreachProperties("tok", fetchImpl),
		).rejects.toBeInstanceOf(HubSpotUnauthorizedError);
	});

	it("otro error tira con el status", async () => {
		const { fetchImpl } = fakeHubSpot({
			existing: [],
			groupExists: true,
			status: 500,
		});
		await expect(ensureOutreachProperties("tok", fetchImpl)).rejects.toThrow(
			/500/,
		);
	});

	it("incluye vector e idioma, las dos propiedades que suma la Etapa 3", () => {
		const names = OUTREACH_PROPERTIES.map((p) => p.name);
		expect(names).toContain("outreach_vector");
		expect(names).toContain("outreach_idioma");
	});
});
