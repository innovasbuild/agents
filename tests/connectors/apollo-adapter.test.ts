import { afterEach, describe, expect, it, vi } from "vitest";
import {
	ApolloOutOfCreditsError,
	ApolloUnauthorizedError,
} from "@/lib/connectors/leads/apollo";
import { createApolloAdapter } from "@/lib/connectors/leads/apollo-adapter";

afterEach(() => vi.unstubAllGlobals());

const CRITERIA = {
	employeeRanges: ["50,200"],
	locations: ["Buenos Aires, Argentina"],
	keywords: ["envases"],
	titles: ["owner", "gerente general"],
};

const ORG = {
	id: "org1",
	name: "Acme",
	primary_domain: "acme.test",
	website_url: "https://acme.test",
	linkedin_url: "https://linkedin.com/company/acme",
	estimated_num_employees: 120,
	industry: "packaging",
	city: "Rosario",
	country: "Argentina",
	founded_year: 1998,
};

const PERSON = {
	id: "p1",
	name: "Laura Gómez",
	title: "Gerente General",
	linkedin_url: "https://linkedin.com/in/laura-gomez",
	organization_id: "org1",
};

describe("searchOrganizations", () => {
	it("manda la llave en x-api-key y traduce los campos de Apollo", async () => {
		const fetchMock = vi.fn<typeof fetch>(async () =>
			Response.json({
				organizations: [ORG],
				pagination: { page: 1, total_pages: 3 },
			}),
		);
		vi.stubGlobal("fetch", fetchMock);

		const result = await createApolloAdapter(["k1"]).searchOrganizations(
			CRITERIA,
			1,
		);

		const [url, init] = fetchMock.mock.calls[0];
		expect(String(url)).toContain("/mixed_companies/search");
		expect(
			(init?.headers as Record<string, string>)["x-api-key"],
		).toBe("k1");
		expect(result.organizations[0]).toEqual({
			externalId: "org1",
			name: "Acme",
			domain: "acme.test",
			linkedinUrl: "https://linkedin.com/company/acme",
			employees: 120,
			industry: "packaging",
			location: "Rosario, Argentina",
			foundedYear: 1998,
		});
		expect(result.hasMore).toBe(true);
		expect(result.creditsUsed).toBe(1);
	});

	it("una empresa sin dominio viaja con domain en null, no se inventa", async () => {
		vi.stubGlobal("fetch", async () =>
			Response.json({
				organizations: [{ ...ORG, primary_domain: null, website_url: null }],
				pagination: { page: 1, total_pages: 1 },
			}),
		);
		const result = await createApolloAdapter(["k1"]).searchOrganizations(
			CRITERIA,
			1,
		);
		expect(result.organizations[0].domain).toBeNull();
		expect(result.hasMore).toBe(false);
	});

	it("lee también la clave accounts si Apollo la usa", async () => {
		// mixed_companies puede devolver las guardadas en la cuenta aparte.
		vi.stubGlobal("fetch", async () =>
			Response.json({
				accounts: [ORG],
				pagination: { page: 1, total_pages: 1 },
			}),
		);
		const result = await createApolloAdapter(["k1"]).searchOrganizations(
			CRITERIA,
			1,
		);
		expect(result.organizations).toHaveLength(1);
	});
});

describe("searchPeople", () => {
	it("filtra por empresa y cargo, y saca el slug de LinkedIn", async () => {
		const fetchMock = vi.fn<typeof fetch>(async () =>
			Response.json({ people: [PERSON], pagination: { page: 1, total_pages: 1 } }),
		);
		vi.stubGlobal("fetch", fetchMock);

		const result = await createApolloAdapter(["k1"]).searchPeople(
			CRITERIA,
			["org1"],
			1,
		);

		const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
		expect(body.organization_ids).toEqual(["org1"]);
		expect(body.person_titles).toEqual(CRITERIA.titles);
		expect(result.people[0]).toEqual({
			externalId: "p1",
			name: "Laura Gómez",
			title: "Gerente General",
			linkedinSlug: "laura-gomez",
			organizationExternalId: "org1",
		});
		// La búsqueda de personas no revela emails: no cuesta crédito de revelado.
		expect(result.creditsUsed).toBe(1);
	});
});

describe("revealEmail", () => {
	it("devuelve el email y cuenta un crédito", async () => {
		vi.stubGlobal("fetch", async () =>
			Response.json({ person: { id: "p1", email: "laura@acme.test" } }),
		);
		const result = await createApolloAdapter(["k1"]).revealEmail("p1");
		expect(result).toEqual({ email: "laura@acme.test", creditsUsed: 1 });
	});

	it("un email bloqueado de Apollo cuenta como sin email, no como error", async () => {
		// Apollo devuelve este literal cuando no puede revelarlo.
		vi.stubGlobal("fetch", async () =>
			Response.json({ person: { id: "p1", email: "email_not_unlocked@domain.com" } }),
		);
		const result = await createApolloAdapter(["k1"]).revealEmail("p1");
		expect(result.email).toBeNull();
	});
});

describe("errores", () => {
	it("un 401 es ApolloUnauthorizedError", async () => {
		vi.stubGlobal("fetch", async () => new Response("nope", { status: 401 }));
		await expect(
			createApolloAdapter(["k1"]).searchOrganizations(CRITERIA, 1),
		).rejects.toBeInstanceOf(ApolloUnauthorizedError);
	});

	it("un 429 tira un error común, que el runner reintenta con espera", async () => {
		vi.stubGlobal("fetch", async () => new Response("slow down", { status: 429 }));
		await expect(
			createApolloAdapter(["k1"]).searchOrganizations(CRITERIA, 1),
		).rejects.toThrow("429");
	});

	it("el error no filtra la llave ni el cuerpo entero", async () => {
		vi.stubGlobal(
			"fetch",
			async () => new Response("x".repeat(5000), { status: 500 }),
		);
		const error = await createApolloAdapter(["secreta"])
			.searchOrganizations(CRITERIA, 1)
			.catch((e: Error) => e);
		expect(String(error)).not.toContain("secreta");
		expect(String(error).length).toBeLessThan(500);
	});
});
