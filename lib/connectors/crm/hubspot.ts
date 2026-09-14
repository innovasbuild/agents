// Esquema de atribución de outreach en HubSpot (kickoff §5, spec 02 §6.1).
// Genérico para cualquier tenant con HubSpot: no es específico de Innovas.

const API = "https://api.hubapi.com";

export const OUTREACH_PROPERTY_GROUP = {
	name: "outreach",
	label: "Outreach",
} as const;

export const OUTREACH_PROPERTIES = [
	{
		name: "contact_key",
		label: "Contact key",
		type: "string",
		fieldType: "text",
	},
	{
		name: "outreach_segmento",
		label: "Outreach · segmento",
		type: "string",
		fieldType: "text",
	},
	{
		name: "outreach_canal",
		label: "Outreach · canal",
		type: "string",
		fieldType: "text",
	},
	{
		name: "outreach_hook",
		label: "Outreach · hook",
		type: "string",
		fieldType: "text",
	},
	{
		name: "outreach_status",
		label: "Outreach · estado",
		type: "string",
		fieldType: "text",
	},
	{
		name: "outreach_owner",
		label: "Outreach · responsable",
		type: "string",
		fieldType: "text",
	},
	{
		name: "outreach_fecha_msg1",
		label: "Outreach · fecha del primer mensaje",
		type: "date",
		fieldType: "date",
	},
	{
		name: "outreach_fecha_respuesta",
		label: "Outreach · fecha de respuesta",
		type: "date",
		fieldType: "date",
	},
] as const;

export class HubSpotUnauthorizedError extends Error {
	constructor() {
		super("HubSpot rechazó el token del usuario");
		this.name = "HubSpotUnauthorizedError";
	}
}

async function call(
	fetchImpl: typeof fetch,
	token: string,
	path: string,
	init: { method?: string; body?: unknown } = {},
): Promise<Response> {
	const response = await fetchImpl(`${API}${path}`, {
		method: init.method ?? "GET",
		headers: {
			Authorization: `Bearer ${token}`,
			...(init.body ? { "Content-Type": "application/json" } : {}),
		},
		...(init.body ? { body: JSON.stringify(init.body) } : {}),
	});
	if (response.status === 401) throw new HubSpotUnauthorizedError();
	return response;
}

async function expectOk(response: Response, what: string): Promise<void> {
	if (!response.ok) {
		throw new Error(
			`HubSpot falló al ${what} (${response.status}): ${await response.text()}`,
		);
	}
}

export async function ensureOutreachProperties(
	token: string,
	fetchImpl: typeof fetch = fetch,
): Promise<{ created: string[]; existing: string[] }> {
	const group = await call(
		fetchImpl,
		token,
		`/crm/v3/properties/contacts/groups/${OUTREACH_PROPERTY_GROUP.name}`,
	);
	if (group.status === 404) {
		await expectOk(
			await call(fetchImpl, token, "/crm/v3/properties/contacts/groups", {
				method: "POST",
				body: { ...OUTREACH_PROPERTY_GROUP, displayOrder: -1 },
			}),
			"crear el grupo outreach",
		);
	} else {
		await expectOk(group, "leer el grupo outreach");
	}

	const list = await call(fetchImpl, token, "/crm/v3/properties/contacts");
	await expectOk(list, "listar las propiedades de contacto");
	const present = new Set(
		((await list.json()) as { results?: { name: string }[] }).results?.map(
			(p) => p.name,
		) ?? [],
	);

	const created: string[] = [];
	const existing: string[] = [];
	for (const property of OUTREACH_PROPERTIES) {
		if (present.has(property.name)) {
			existing.push(property.name);
			continue;
		}
		await expectOk(
			await call(fetchImpl, token, "/crm/v3/properties/contacts", {
				method: "POST",
				body: { ...property, groupName: OUTREACH_PROPERTY_GROUP.name },
			}),
			`crear la propiedad ${property.name}`,
		);
		created.push(property.name);
	}

	return { created, existing };
}
