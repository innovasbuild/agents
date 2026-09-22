import { afterEach, describe, expect, it, vi } from "vitest";
import { ApolloOutOfCreditsError } from "@/lib/connectors/leads/apollo";
import { createApolloAdapter } from "@/lib/connectors/leads/apollo-adapter";

afterEach(() => vi.unstubAllGlobals());

const CRITERIA = {
	employeeRanges: [],
	locations: [],
	keywords: [],
	titles: [],
};

function fetchByKey(behavior: Record<string, () => Response>) {
	return vi.fn<typeof fetch>(async (_url, init) => {
		const key = (init?.headers as Record<string, string>)["x-api-key"];
		return behavior[key]();
	});
}

describe("fallback entre llaves", () => {
	it("si la primera se quedó sin crédito, usa la segunda", async () => {
		const fetchMock = fetchByKey({
			k1: () => new Response("insufficient credits", { status: 402 }),
			k2: () =>
				Response.json({ organizations: [], pagination: { page: 1, total_pages: 1 } }),
		});
		vi.stubGlobal("fetch", fetchMock);

		const result = await createApolloAdapter(["k1", "k2"]).searchOrganizations(
			CRITERIA,
			1,
		);

		expect(result.organizations).toEqual([]);
		expect(fetchMock).toHaveBeenCalledTimes(2);
	});

	it("si ninguna tiene crédito, tira para que el runner lo reintente después", async () => {
		vi.stubGlobal(
			"fetch",
			async () => new Response("insufficient credits", { status: 402 }),
		);
		await expect(
			createApolloAdapter(["k1", "k2"]).searchOrganizations(CRITERIA, 1),
		).rejects.toBeInstanceOf(ApolloOutOfCreditsError);
	});

	it("un error que no es de crédito no prueba la otra llave", async () => {
		// Un 500 es un problema de Apollo, no de la llave: gastar la segunda no ayuda.
		const fetchMock = vi.fn<typeof fetch>(
			async () => new Response("boom", { status: 500 }),
		);
		vi.stubGlobal("fetch", fetchMock);

		await expect(
			createApolloAdapter(["k1", "k2"]).searchOrganizations(CRITERIA, 1),
		).rejects.toThrow("500");
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it("el fallback vale para las tres operaciones", async () => {
		const fetchMock = fetchByKey({
			k1: () => new Response("insufficient credits", { status: 402 }),
			k2: () => Response.json({ person: { email: "l@acme.test" } }),
		});
		vi.stubGlobal("fetch", fetchMock);

		const result = await createApolloAdapter(["k1", "k2"]).revealEmail("p1");
		expect(result.email).toBe("l@acme.test");
	});
});
