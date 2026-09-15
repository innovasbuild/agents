import { describe, expect, it } from "vitest";
import { HubSpotUnauthorizedError } from "@/lib/connectors/crm/hubspot";
import { createHubSpotAdapter } from "@/lib/connectors/crm/hubspot-adapter";

type Call = { url: string; method: string; body: unknown; auth: string | null };

function fakeHubSpot(responses: Array<{ status?: number; json?: unknown }>) {
	const calls: Call[] = [];
	const fetchImpl = (async (url: string, init: RequestInit) => {
		calls.push({
			url,
			method: init.method ?? "GET",
			body: init.body ? JSON.parse(init.body as string) : null,
			auth: new Headers(init.headers).get("authorization"),
		});
		const next = responses.shift() ?? { status: 200, json: {} };
		const status = next.status ?? 200;
		return new Response(
			status === 204 ? null : JSON.stringify(next.json ?? {}),
			{ status },
		);
	}) as unknown as typeof fetch;
	return { calls, fetchImpl };
}

describe("createHubSpotAdapter", () => {
	it("findContacts busca en OR por contact_key, email y LinkedIn y normaliza", async () => {
		const { calls, fetchImpl } = fakeHubSpot([
			{
				json: {
					results: [
						{
							id: "101",
							properties: {
								email: "Laura@Acme.test",
								contact_key: "em:laura@acme.test",
								hs_linkedin_url: "https://www.linkedin.com/in/laura-gomez/",
								hubspot_owner_id: "9",
							},
						},
					],
				},
			},
		]);
		const matches = await createHubSpotAdapter("tok", fetchImpl).findContacts({
			contactKey: "em:laura@acme.test",
			email: "laura@acme.test",
			linkedinSlug: "laura-gomez",
		});
		expect(matches).toEqual([
			{
				id: "101",
				contactKey: "em:laura@acme.test",
				email: "laura@acme.test",
				linkedinSlugs: ["laura-gomez"],
				ownerId: "9",
			},
		]);
		expect(calls[0].url).toBe(
			"https://api.hubapi.com/crm/v3/objects/contacts/search",
		);
		expect(
			(calls[0].body as { filterGroups: unknown[] }).filterGroups,
		).toHaveLength(3);
		expect(calls[0].auth).toBe("Bearer tok");
	});

	it("lastAuthorship toma la nota o el email más reciente con owner", async () => {
		const { calls, fetchImpl } = fakeHubSpot([
			{
				json: {
					results: [
						{
							id: "n1",
							properties: {
								hubspot_owner_id: "9",
								hs_timestamp: "2026-09-01T10:00:00Z",
							},
						},
					],
				},
			},
			{
				json: {
					results: [
						{
							id: "e1",
							properties: {
								hubspot_owner_id: "7",
								hs_timestamp: "2026-09-10T10:00:00Z",
							},
						},
					],
				},
			},
		]);
		const authorship = await createHubSpotAdapter(
			"tok",
			fetchImpl,
		).lastAuthorship("101");
		expect(authorship).toEqual({
			ownerId: "7",
			at: new Date("2026-09-10T10:00:00Z"),
		});
		// La búsqueda pide solo actividad con owner: si la más reciente no tiene
		// owner (ej. un email logueado por una integración), no hay que verla.
		for (const call of calls) {
			expect(
				(call.body as { filterGroups: Array<{ filters: unknown[] }> })
					.filterGroups[0].filters,
			).toContainEqual({
				propertyName: "hubspot_owner_id",
				operator: "HAS_PROPERTY",
			});
		}
	});

	it("upsertContact crea con nombre y empresa, o actualiza solo propiedades", async () => {
		const created = fakeHubSpot([{ status: 201, json: { id: "202" } }]);
		expect(
			await createHubSpotAdapter("tok", created.fetchImpl).upsertContact({
				crmId: null,
				email: "laura@acme.test",
				name: "Laura Gómez Paz",
				company: "Acme",
				properties: { contact_key: "em:laura@acme.test" },
			}),
		).toBe("202");
		expect(created.calls[0]).toMatchObject({
			method: "POST",
			body: {
				properties: {
					email: "laura@acme.test",
					firstname: "Laura",
					lastname: "Gómez Paz",
					company: "Acme",
					contact_key: "em:laura@acme.test",
				},
			},
		});

		const updated = fakeHubSpot([{ json: { id: "101" } }]);
		expect(
			await createHubSpotAdapter("tok", updated.fetchImpl).upsertContact({
				crmId: "101",
				email: "laura@acme.test",
				name: "Laura",
				company: "Acme",
				properties: { outreach_status: "msg1_enviado" },
			}),
		).toBe("101");
		expect(updated.calls[0]).toMatchObject({
			method: "PATCH",
			url: "https://api.hubapi.com/crm/v3/objects/contacts/101",
			body: { properties: { outreach_status: "msg1_enviado" } },
		});
	});

	it("nota y task van asociadas al contacto (typeId 202 y 204)", async () => {
		const { calls, fetchImpl } = fakeHubSpot([
			{ status: 201, json: { id: "n" } },
			{ status: 201, json: { id: "t" } },
		]);
		const adapter = createHubSpotAdapter("tok", fetchImpl);
		await adapter.addNote("101", {
			body: "[out · msg1]",
			at: new Date("2026-09-15T12:00:00Z"),
			ownerId: "9",
		});
		await adapter.createTask("101", {
			title: "Siguiente toque",
			dueAt: new Date("2026-09-19T12:00:00Z"),
			ownerId: "9",
		});
		expect(calls[0].body).toEqual({
			properties: {
				hs_timestamp: "2026-09-15T12:00:00.000Z",
				hs_note_body: "[out · msg1]",
				hubspot_owner_id: "9",
			},
			associations: [
				{
					to: { id: "101" },
					types: [
						{ associationCategory: "HUBSPOT_DEFINED", associationTypeId: 202 },
					],
				},
			],
		});
		expect(
			(
				calls[1].body as {
					associations: Array<{ types: Array<{ associationTypeId: number }> }>;
				}
			).associations[0].types[0].associationTypeId,
		).toBe(204);
	});

	it("completeOpenTasks marca COMPLETED las tasks abiertas del contacto", async () => {
		const { calls, fetchImpl } = fakeHubSpot([
			{
				json: {
					results: [
						{ id: "t1", properties: {} },
						{ id: "t2", properties: {} },
					],
				},
			},
			{ json: {} },
			{ json: {} },
		]);
		await createHubSpotAdapter("tok", fetchImpl).completeOpenTasks("101");
		expect(calls.slice(1).map((c) => [c.method, c.url, c.body])).toEqual([
			[
				"PATCH",
				"https://api.hubapi.com/crm/v3/objects/tasks/t1",
				{ properties: { hs_task_status: "COMPLETED" } },
			],
			[
				"PATCH",
				"https://api.hubapi.com/crm/v3/objects/tasks/t2",
				{ properties: { hs_task_status: "COMPLETED" } },
			],
		]);
	});

	it("un 401 es HubSpotUnauthorizedError y otro error trae status y método", async () => {
		await expect(
			createHubSpotAdapter(
				"tok",
				fakeHubSpot([{ status: 401 }]).fetchImpl,
			).lastAuthorship("1"),
		).rejects.toBeInstanceOf(HubSpotUnauthorizedError);
		await expect(
			createHubSpotAdapter(
				"tok",
				fakeHubSpot([{ status: 500, json: { message: "boom" } }]).fetchImpl,
			).addNote("1", { body: "x", at: new Date(), ownerId: null }),
		).rejects.toThrow("HubSpot respondió 500 en POST /crm/v3/objects/notes");
	});
});
