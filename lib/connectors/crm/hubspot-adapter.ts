// HubSpot por REST con el token del conector del MCP (spec 03 §13.1 S6).
import { linkedinSlug } from "../../outreach/contact-key";
import type { CrmAdapter, CrmContactMatch } from "./adapter";
import { HubSpotUnauthorizedError } from "./hubspot";

const API = "https://api.hubapi.com";
const TIMEOUT_MS = 10_000;

type SearchResult = {
	results?: Array<{
		id: string;
		properties: Record<string, string | null | undefined>;
	}>;
};

const association = (crmId: string, associationTypeId: number) => ({
	to: { id: crmId },
	types: [{ associationCategory: "HUBSPOT_DEFINED", associationTypeId }],
});

export function createHubSpotAdapter(
	token: string,
	fetchImpl: typeof fetch = fetch,
): CrmAdapter {
	async function call(
		path: string,
		init: { method?: string; body?: unknown } = {},
	): Promise<unknown> {
		const method = init.method ?? "GET";
		const response = await fetchImpl(`${API}${path}`, {
			method,
			headers: {
				Authorization: `Bearer ${token}`,
				...(init.body ? { "Content-Type": "application/json" } : {}),
			},
			...(init.body ? { body: JSON.stringify(init.body) } : {}),
			signal: AbortSignal.timeout(TIMEOUT_MS),
		});
		if (response.status === 401) throw new HubSpotUnauthorizedError();
		if (!response.ok) {
			throw new Error(
				`HubSpot respondió ${response.status} en ${method} ${path}: ${(await response.text()).slice(0, 300)}`,
			);
		}
		return response.status === 204 ? null : response.json();
	}

	const searchAssociated = (
		object: string,
		crmId: string,
		extraFilters: object[],
		properties: string[],
		limit: number,
	) =>
		call(`/crm/v3/objects/${object}/search`, {
			method: "POST",
			body: {
				filterGroups: [
					{
						filters: [
							{
								propertyName: "associations.contact",
								operator: "EQ",
								value: crmId,
							},
							...extraFilters,
						],
					},
				],
				sorts: [{ propertyName: "hs_timestamp", direction: "DESCENDING" }],
				properties,
				limit,
			},
		}) as Promise<SearchResult>;

	return {
		async findContacts({ contactKey, email, linkedinSlug: slug }) {
			const filterGroups = [
				{
					filters: [
						{ propertyName: "contact_key", operator: "EQ", value: contactKey },
					],
				},
				...(email
					? [
							{
								filters: [
									{ propertyName: "email", operator: "EQ", value: email },
								],
							},
						]
					: []),
				...(slug
					? [
							{
								filters: [
									{
										propertyName: "hs_linkedin_url",
										operator: "CONTAINS_TOKEN",
										value: slug,
									},
								],
							},
						]
					: []),
			];
			const data = (await call("/crm/v3/objects/contacts/search", {
				method: "POST",
				body: {
					filterGroups,
					properties: [
						"email",
						"contact_key",
						"hs_linkedin_url",
						"hubspot_owner_id",
					],
					limit: 10,
				},
			})) as SearchResult;
			return (data.results ?? []).map(
				(row): CrmContactMatch => ({
					id: row.id,
					contactKey: row.properties.contact_key ?? null,
					email: row.properties.email?.toLowerCase() ?? null,
					linkedinSlugs: [linkedinSlug(row.properties.hs_linkedin_url)].filter(
						(value): value is string => Boolean(value),
					),
					ownerId: row.properties.hubspot_owner_id ?? null,
				}),
			);
		},

		async lastAuthorship(crmId) {
			let latest: { ownerId: string; at: Date } | null = null;
			for (const object of ["notes", "emails"]) {
				const data = await searchAssociated(
					object,
					crmId,
					[{ propertyName: "hubspot_owner_id", operator: "HAS_PROPERTY" }],
					["hubspot_owner_id", "hs_timestamp"],
					1,
				);
				const row = data.results?.[0];
				const ownerId = row?.properties.hubspot_owner_id;
				const timestamp = row?.properties.hs_timestamp;
				if (!ownerId || !timestamp) continue;
				const at = new Date(timestamp);
				if (!latest || at > latest.at) latest = { ownerId, at };
			}
			return latest;
		},

		async upsertContact({ crmId, email, name, company, properties }) {
			if (crmId) {
				await call(`/crm/v3/objects/contacts/${crmId}`, {
					method: "PATCH",
					body: { properties },
				});
				return crmId;
			}
			const [firstname, ...rest] = (name ?? "")
				.trim()
				.split(/\s+/)
				.filter(Boolean);
			const created = (await call("/crm/v3/objects/contacts", {
				method: "POST",
				body: {
					properties: {
						...(email ? { email } : {}),
						...(firstname ? { firstname } : {}),
						...(rest.length > 0 ? { lastname: rest.join(" ") } : {}),
						...(company ? { company } : {}),
						...properties,
					},
				},
			})) as { id: string };
			return created.id;
		},

		async addNote(crmId, { body, at, ownerId }) {
			await call("/crm/v3/objects/notes", {
				method: "POST",
				body: {
					properties: {
						hs_timestamp: at.toISOString(),
						hs_note_body: body,
						...(ownerId ? { hubspot_owner_id: ownerId } : {}),
					},
					associations: [association(crmId, 202)],
				},
			});
		},

		async completeOpenTasks(crmId) {
			const data = await searchAssociated(
				"tasks",
				crmId,
				[
					{
						propertyName: "hs_task_status",
						operator: "NEQ",
						value: "COMPLETED",
					},
				],
				["hs_task_status"],
				100,
			);
			for (const task of data.results ?? []) {
				await call(`/crm/v3/objects/tasks/${task.id}`, {
					method: "PATCH",
					body: { properties: { hs_task_status: "COMPLETED" } },
				});
			}
		},

		async createTask(crmId, { title, dueAt, ownerId }) {
			await call("/crm/v3/objects/tasks", {
				method: "POST",
				body: {
					properties: {
						hs_timestamp: dueAt.toISOString(),
						hs_task_subject: title,
						hs_task_status: "NOT_STARTED",
						...(ownerId ? { hubspot_owner_id: ownerId } : {}),
					},
					associations: [association(crmId, 204)],
				},
			});
		},

		async listOpenDeals(contactCrmId) {
			const data = await searchAssociated(
				"deals",
				contactCrmId,
				[],
				["dealstage"],
				100,
			);
			return (data.results ?? [])
				.filter(
					(row) =>
						row.properties.dealstage !== "closedwon" &&
						row.properties.dealstage !== "closedlost",
				)
				.map((row) => ({ id: row.id, stage: row.properties.dealstage ?? "" }));
		},

		async createDeal({
			contactCrmId,
			companyCrmId,
			name,
			description,
			ownerId,
		}) {
			const created = (await call("/crm/v3/objects/deals", {
				method: "POST",
				body: {
					properties: {
						dealname: name,
						pipeline: "default",
						dealstage: "1404975950",
						description,
						hubspot_owner_id: ownerId,
					},
					associations: [
						association(contactCrmId, 3),
						...(companyCrmId ? [association(companyCrmId, 341)] : []),
					],
				},
			})) as { id: string };
			return { id: created.id };
		},
	};
}
