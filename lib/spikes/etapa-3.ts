// TEMPORAL (spec 03 §13): se borra después de correr los spikes en producción.

export interface ProbeDeps {
	tokenForSubject: (
		connector: string,
		who: { tenantId: string; userId: string; issuer?: string },
		scopes?: string[],
	) => Promise<{ token: string; expiresAt: number }>;
	fetch: typeof fetch;
	generate: (
		model: string,
		auth: "api_key" | "oidc",
	) => Promise<{ output: unknown; usage: unknown }>;
	now: () => number;
}

export interface ProbeInput {
	tenantId: string;
	userId: string;
	issuer: string;
	hubspotWrite: boolean;
}

export type ProbeStep = { step: string; ok: boolean; detail: string };

const HUBSPOT_BASE = "https://api.hubapi.com";
const FETCH_TIMEOUT_MS = 10_000;
const MAX_DETAIL_LENGTH = 500;
const MODELS = [
	"anthropic/claude-opus-5",
	"anthropic/claude-sonnet-5",
	"anthropic/claude-haiku-4.5",
];

// Corre un paso aislado: si `fn` tira, el paso queda ok:false con el nombre y
// mensaje del error (nunca un token, porque `fn` nunca lo devuelve como
// mensaje de error propio). Un paso que falla nunca frena a los demás. El
// detail se corta a MAX_DETAIL_LENGTH: HubSpot/Gmail pueden devolver bodies
// de error largos y el reporte tiene que quedar corto igual.
async function runStep(
	step: string,
	fn: () => Promise<string>,
): Promise<ProbeStep> {
	try {
		const detail = await fn();
		return { step, ok: true, detail: detail.slice(0, MAX_DETAIL_LENGTH) };
	} catch (error) {
		const detail =
			error instanceof Error
				? `${error.name}: ${error.message}`
				: String(error);
		return { step, ok: false, detail: detail.slice(0, MAX_DETAIL_LENGTH) };
	}
}

function vence(expiresAt: number): string {
	return new Date(expiresAt).toISOString();
}

async function errorDetail(response: Response): Promise<string> {
	// HubSpot no devuelve tokens en el body de error, solo el motivo del
	// rechazo: cortamos a 300 caracteres para que el detail quede corto.
	let body = "";
	try {
		body = (await response.text()).slice(0, 300);
	} catch {
		body = "";
	}
	return `${response.status} ${body}`.trim();
}

async function postJson(
	fetchFn: typeof fetch,
	url: string,
	token: string,
	payload: unknown,
): Promise<{ status: number; id: string }> {
	const response = await fetchFn(url, {
		method: "POST",
		headers: {
			Authorization: `Bearer ${token}`,
			"Content-Type": "application/json",
		},
		body: JSON.stringify(payload),
		signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
	});
	if (!response.ok) {
		throw new Error(await errorDetail(response));
	}
	const json = (await response.json()) as { id: string };
	return { status: response.status, id: json.id };
}

export async function runEtapa3Probes(
	input: ProbeInput,
	deps: ProbeDeps,
): Promise<ProbeStep[]> {
	const { tenantId, userId, issuer, hubspotWrite } = input;
	const steps: ProbeStep[] = [];

	steps.push(
		await runStep("s1.google.con_issuer", async () => {
			const { token, expiresAt } = await deps.tokenForSubject(
				"google/google",
				{ tenantId, userId, issuer },
				["https://www.googleapis.com/auth/gmail.send"],
			);
			const response = await deps.fetch(
				"https://gmail.googleapis.com/gmail/v1/users/me/profile",
				{
					headers: { Authorization: `Bearer ${token}` },
					signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
				},
			);
			return `token ok, vence ${vence(expiresAt)}, gmail profile ${response.status}`;
		}),
	);

	steps.push(
		await runStep("s1.google.sin_issuer", async () => {
			const { expiresAt } = await deps.tokenForSubject(
				"google/google",
				{ tenantId, userId },
				["https://www.googleapis.com/auth/gmail.send"],
			);
			return `token ok, vence ${vence(expiresAt)}`;
		}),
	);

	// El token de este paso se guarda en una variable local (nunca en
	// `steps`) para reusarlo en los pasos s6.* si hubspotWrite lo pide.
	let hubspotToken: string | undefined;
	steps.push(
		await runStep("s1.hubspot.con_issuer", async () => {
			const { token, expiresAt } = await deps.tokenForSubject(
				"mcp.hubspot.com/hubspot",
				{ tenantId, userId, issuer },
			);
			hubspotToken = token;
			const response = await deps.fetch(
				`${HUBSPOT_BASE}/crm/v3/properties/contacts?archived=false`,
				{
					headers: { Authorization: `Bearer ${token}` },
					signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
				},
			);
			return `token ok, vence ${vence(expiresAt)}, contacts ${response.status}`;
		}),
	);

	steps.push(
		await runStep("s1.hubspot.sin_issuer", async () => {
			const { expiresAt } = await deps.tokenForSubject(
				"mcp.hubspot.com/hubspot",
				{ tenantId, userId },
			);
			return `token ok, vence ${vence(expiresAt)}`;
		}),
	);

	if (hubspotWrite && hubspotToken) {
		const token = hubspotToken;
		let contactId: string | undefined;

		steps.push(
			await runStep("s6.contacto", async () => {
				const { status, id } = await postJson(
					deps.fetch,
					`${HUBSPOT_BASE}/crm/v3/objects/contacts`,
					token,
					{
						properties: {
							email: `spike-etapa3-${deps.now()}@example.com`,
							firstname: "Spike",
							lastname: "Etapa3",
						},
					},
				);
				contactId = id;
				return `${status}, id ${id}`;
			}),
		);

		if (contactId) {
			const id = contactId;
			const association = (associationTypeId: number) => [
				{
					to: { id },
					types: [
						{ associationCategory: "HUBSPOT_DEFINED", associationTypeId },
					],
				},
			];

			steps.push(
				await runStep("s6.nota", async () => {
					const { status, id: noteId } = await postJson(
						deps.fetch,
						`${HUBSPOT_BASE}/crm/v3/objects/notes`,
						token,
						{
							properties: {
								hs_timestamp: new Date(deps.now()).toISOString(),
								hs_note_body: "[out · spike]",
							},
							associations: association(202),
						},
					);
					return `${status}, id ${noteId}`;
				}),
			);

			steps.push(
				await runStep("s6.task", async () => {
					const { status, id: taskId } = await postJson(
						deps.fetch,
						`${HUBSPOT_BASE}/crm/v3/objects/tasks`,
						token,
						{
							properties: {
								hs_timestamp: new Date(deps.now() + 86_400_000).toISOString(),
								hs_task_subject: "spike etapa 3",
								hs_task_status: "NOT_STARTED",
							},
							associations: association(204),
						},
					);
					return `${status}, id ${taskId}`;
				}),
			);

			steps.push(
				await runStep("s6.deal", async () => {
					const { status, id: dealId } = await postJson(
						deps.fetch,
						`${HUBSPOT_BASE}/crm/v3/objects/deals`,
						token,
						{
							properties: {
								dealname: `Spike etapa 3 ${deps.now()}`,
								pipeline: "default",
							},
							associations: association(3),
						},
					);
					return `${status}, id ${dealId}`;
				}),
			);

			steps.push(
				await runStep("s6.archivar_contacto", async () => {
					const response = await deps.fetch(
						`${HUBSPOT_BASE}/crm/v3/objects/contacts/${id}`,
						{
							method: "DELETE",
							headers: { Authorization: `Bearer ${token}` },
							signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
						},
					);
					if (!response.ok) {
						throw new Error(await errorDetail(response));
					}
					return `${response.status}`;
				}),
			);
		}
	}

	for (const model of MODELS) {
		for (const auth of ["api_key", "oidc"] as const) {
			steps.push(
				await runStep(`s3.${auth}.${model}`, async () => {
					const start = deps.now();
					const { output, usage } = await deps.generate(model, auth);
					const ms = deps.now() - start;
					return `${ms} ms, output ${JSON.stringify(output)}, usage ${JSON.stringify(usage)}`;
				}),
			);
		}
	}

	return steps;
}
