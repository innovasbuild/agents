import { afterEach, describe, expect, it, vi } from "vitest";
import { createHubSpotAdapter } from "@/lib/connectors/crm/hubspot-adapter";

afterEach(() => vi.unstubAllGlobals());

describe("createDeal", () => {
	it("crea el deal en el pipeline y stage que fija el CLAUDE.md", async () => {
		const fetchMock = vi.fn<typeof fetch>(async () =>
			Response.json({ id: "d1" }),
		);
		vi.stubGlobal("fetch", fetchMock);

		await createHubSpotAdapter("tok").createDeal({
			contactCrmId: "c1",
			companyCrmId: "e1",
			name: "En Paralelo · Acme",
			description: "vector: linkedin · hook: cuello_operativo · canal: email",
			ownerId: "92296278",
		});

		const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
		expect(body.properties.pipeline).toBe("default");
		expect(body.properties.dealstage).toBe("1404975950");
	});

	it("repite el origen en description, que es lo que pide la regla del repo", async () => {
		const fetchMock = vi.fn<typeof fetch>(async () =>
			Response.json({ id: "d1" }),
		);
		vi.stubGlobal("fetch", fetchMock);

		await createHubSpotAdapter("tok").createDeal({
			contactCrmId: "c1",
			companyCrmId: null,
			name: "En Paralelo · Acme",
			description: "vector: linkedin · hook: cuello_operativo · canal: email",
			ownerId: "92296278",
		});

		const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
		expect(body.properties.description).toContain("linkedin");
	});
});

describe("listOpenDeals", () => {
	it("no cuenta como abierto un deal en closedwon ni en closedlost", async () => {
		vi.stubGlobal("fetch", async () =>
			Response.json({
				results: [
					{ id: "d1", properties: { dealstage: "closedwon" } },
					{ id: "d2", properties: { dealstage: "decisionmakerboughtin" } },
					{ id: "d3", properties: { dealstage: "closedlost" } },
				],
			}),
		);

		const open = await createHubSpotAdapter("tok").listOpenDeals("c1");

		expect(open.map((d) => d.id)).toEqual(["d2"]);
	});
});
