// Cableado del dispatcher de workflows (spec orquestación §6.5). Toda la
// lógica vive en lib/workflows/dispatch.ts, con dependencias inyectadas y
// testeada; acá solo se arman las deps reales.
//
// **Este schedule no manda mail ni escribe en el CRM.** El único nodo que
// entrega es outreach/research (nivel 1): no hay ninguna dep de envío acá
// abajo, y el runner igual niega el nivel 3.
//
// Imports relativos y no "@/": eve no resuelve los paths de tsconfig en los
// módulos que compila.
import { experimental_evaluate, generateText } from "ai";
import { defineSchedule } from "eve/schedules";
import { apiKeyValues } from "../../../lib/connectors/auth";
import { loadTenantBindings } from "../../../lib/connectors/bindings";
import { createApolloAdapter } from "../../../lib/connectors/leads/apollo-adapter";
import { brainForTenant, loadCanon } from "../../../lib/outreach/canon";
import { isFichaVigente } from "../../../lib/outreach/ficha";
import { refuse } from "../../../lib/outreach/result";
import { draftMessage } from "../../../lib/outreach/services/draft";
import { runEvaluation } from "../../../lib/outreach/services/evaluate";
import { generateDraft } from "../../../lib/outreach/services/generate-draft";
import { generateResearch } from "../../../lib/outreach/services/generate-research";
import { scoreContact } from "../../../lib/outreach/services/icp-score";
import { queueTouch } from "../../../lib/outreach/services/queue";
import { researchAccount } from "../../../lib/outreach/services/research";
import { revealContactEmail } from "../../../lib/outreach/services/reveal-email";
import { searchTargetsPage } from "../../../lib/outreach/services/target-search";
import { verifyFact } from "../../../lib/outreach/services/verify-fact";
import type { Caller } from "../../../lib/outreach/session";
import { createSupabaseOutreachStore } from "../../../lib/outreach/store";
import { dayStart } from "../../../lib/outreach/time";
import { fetchPublicPage, resolveHost } from "../../../lib/outreach/web-page";
import { createContactEnrichmentWorkflow } from "../../../lib/outreach/workflows/contact-enrichment";
import { createDraftQueueWorkflow } from "../../../lib/outreach/workflows/draft-queue";
import {
	createIcpScoringWorkflow,
	type IcpScoreNode,
} from "../../../lib/outreach/workflows/icp-scoring";
import {
	createRefreshFichas,
	type ResearchNode,
} from "../../../lib/outreach/workflows/refresh-fichas";
import { createTargetSearchWorkflow } from "../../../lib/outreach/workflows/target-search";
import { createAdminClient } from "../../../lib/supabase/admin";
import {
	type DispatchTenant,
	ITEM_TIMEOUT_MS,
	runDispatch,
} from "../../../lib/workflows/dispatch";
import { createSupabaseWorkflowStore } from "../../../lib/workflows/store";
import { createUsageRecorder, metered } from "../../../lib/workflows/usage";

const AGENT = "outreach";

export default defineSchedule({
	// Cada 5 minutos, en UTC. Esto es cada cuánto se pregunta a quién le toca:
	// la cadencia de cada workflow la pone su config por tenant.
	cron: "*/5 * * * *",
	async run() {
		const admin = createAdminClient();
		const outreach = createSupabaseOutreachStore(admin);
		const record = createUsageRecorder(admin);

		const research: ResearchNode = ({
			tenantId,
			runId,
			workflow,
			domain,
			name,
		}) => {
			// Un solo tope por ítem para las dos cosas que puede tardar: la llamada
			// al modelo y cualquier lectura de página en curso. El SDK solo chequea
			// el abort entre steps, así que sin sumar esta señal al fetch de
			// fetchPublicPage una lectura ya arrancada podía seguir hasta su propio
			// timeout interno (~10s por hop, con redirecciones) y el ítem entero
			// pasar los ITEM_TIMEOUT_MS. El runner igual mira el reloj antes de
			// reclamar, no durante un ítem: este tope es la única red debajo.
			const signal = AbortSignal.timeout(ITEM_TIMEOUT_MS);
			return researchAccount(
				{ tenantId, userId: null, domain, name },
				{
					store: outreach,
					now: () => new Date(),
					readPage: (url) =>
						fetchPublicPage(url, {
							resolveHost,
							fetchImpl: (input, init) =>
								fetch(input, {
									...init,
									signal: init?.signal
										? AbortSignal.any([init.signal, signal])
										: signal,
								}),
						}),
					generate: metered(
						(args: Parameters<typeof generateResearch>[0]) =>
							generateResearch(args, { generateText, abortSignal: signal }),
						{
							model: (args) => args.model,
							record,
							base: {
								tenantId,
								runId,
								workflow,
								node: "outreach/research",
							},
						},
					),
				},
			);
		};

		const icpScore: IcpScoreNode = ({ tenantId, runId, workflow, contactId }) =>
			scoreContact(
				{ tenantId, contactId },
				{
					store: outreach,
					now: () => new Date(),
					evaluate: metered(
						(args: Parameters<typeof runEvaluation>[0]) =>
							runEvaluation(args, { evaluate: experimental_evaluate }),
						{
							model: (args) => args.model,
							record,
							base: {
								tenantId,
								runId,
								workflow,
								node: "outreach/icp-score",
							},
						},
					),
				},
			);

		// target-search no llega por ctx.useNode como research (que recibe el
		// tenant explícito en cada llamada): sus deps son fijas para todos los
		// tenants, así que `recordCredits` (a la que el workflow solo le pasa
		// credits y runId, spec etapa 13 Task 9) no tiene de dónde sacar el
		// tenant salvo de acá. Guardarlo en esta variable alcanza porque el
		// dispatcher nunca corre las pasadas de dos tenants a la vez
		// (runDispatch las recorre con un for secuencial) ni dos ítems de la
		// misma pasada a la vez (runWorkflowPass, "de a uno"): `search` la fija
		// justo antes de que el workflow pueda volver a llamar a `recordCredits`.
		let targetSearchTenantId: string | null = null;

		const targetSearch = createTargetSearchWorkflow({
			loadFocuses: (tenantId) => outreach.listActiveFocuses(tenantId),
			loadFocus: (tenantId, id) => outreach.loadFocus(tenantId, id),
			updateFocus: (tenantId, id, patch) =>
				outreach.updateFocus(tenantId, id, patch),
			async search(focus, page) {
				targetSearchTenantId = focus.tenantId;
				const bindings = await loadTenantBindings(focus.tenantId);
				const binding = bindings.find(
					(b) => b.capability === "leads" && b.provider === "apollo",
				);
				const connectorUids =
					(binding?.config.connectorUids as string[] | undefined) ?? [];
				if (connectorUids.length === 0) {
					return refuse(
						"sin_binding_apollo",
						"el tenant no tiene Apollo conectado",
					);
				}
				const keys = await apiKeyValues(connectorUids);
				return searchTargetsPage(
					{ focus, page },
					{
						store: outreach,
						leads: createApolloAdapter(keys),
						crm: null,
						now: () => new Date(),
					},
				);
			},
			recordCredits: (credits, runId) =>
				record({
					tenantId: targetSearchTenantId as string,
					runId,
					workflow: "target-search",
					node: "outreach/target-search",
					resource: "apollo_credits",
					amount: credits,
					unit: "credits",
					meta: {},
				}),
		});

		// Mismo motivo que targetSearchTenantId más arriba: reveal y ensureFicha
		// (ContactEnrichmentDeps) solo reciben el contactId, no el tenant — el
		// runner nunca corre dos pasadas ni dos ítems a la vez, así que esta
		// variable, fijada al entrar a runItem, ya está resuelta cuando esas
		// funciones la leen.
		let contactEnrichmentCtx: { tenantId: string; runId: string } | null =
			null;

		const contactEnrichmentImpl = createContactEnrichmentWorkflow({
			async reveal(contactId) {
				const { tenantId } = contactEnrichmentCtx as {
					tenantId: string;
					runId: string;
				};
				const bindings = await loadTenantBindings(tenantId);
				const binding = bindings.find(
					(b) => b.capability === "leads" && b.provider === "apollo",
				);
				const connectorUids =
					(binding?.config.connectorUids as string[] | undefined) ?? [];
				if (connectorUids.length === 0) {
					return refuse(
						"sin_binding_apollo",
						"el tenant no tiene Apollo conectado",
					);
				}
				const keys = await apiKeyValues(connectorUids);
				return revealContactEmail(
					{ tenantId, contactId },
					{ store: outreach, leads: createApolloAdapter(keys) },
				);
			},
			async ensureFicha(contactId) {
				const { tenantId, runId } = contactEnrichmentCtx as {
					tenantId: string;
					runId: string;
				};
				const contact = await outreach.findContactById(tenantId, contactId);
				if (!contact?.accountId) {
					return refuse(
						"sin_cuenta",
						`el contacto ${contactId} no tiene cuenta asociada`,
					);
				}
				const account = await outreach.findAccountById(
					tenantId,
					contact.accountId,
				);
				if (!account?.domain) {
					return refuse(
						"sin_cuenta",
						`la cuenta del contacto ${contactId} no tiene dominio`,
					);
				}
				if (isFichaVigente(new Date(account.expiresAt), new Date())) {
					return { ok: true };
				}
				const result = await research({
					tenantId,
					runId,
					workflow: "contact-enrichment",
					domain: account.domain,
					name: account.name,
				});
				return result.ok
					? { ok: true }
					: { ok: false, reason: result.reason, message: result.message };
			},
			recordCredits: (credits, runId) =>
				record({
					tenantId: (contactEnrichmentCtx as { tenantId: string }).tenantId,
					runId,
					workflow: "contact-enrichment",
					node: "outreach/reveal-email",
					resource: "apollo_credits",
					amount: credits,
					unit: "credits",
					meta: {},
				}),
		});

		const contactEnrichment = {
			async runItem(
				item: Parameters<typeof contactEnrichmentImpl.runItem>[0],
				ctx: Parameters<typeof contactEnrichmentImpl.runItem>[1],
			) {
				contactEnrichmentCtx = { tenantId: ctx.tenantId, runId: ctx.runId };
				return contactEnrichmentImpl.runItem(item, ctx);
			},
		};

		// Mismo motivo que contactEnrichmentCtx: ownerOf/quotaFor/queuedToday/
		// listReady (DraftQueueDeps) solo reciben el contactId o el
		// executorUserId, nunca el tenant — se fija acá, al entrar a runItem (o
		// al sembrar), y ya está resuelto cuando esas funciones la leen. El
		// runner nunca corre dos pasadas ni dos ítems a la vez.
		let draftQueueCtx: { tenantId: string; runId: string } | null = null;
		// El draft completo (con hook/vector/idioma, que DraftQueueDeps no
		// expone) para que `queue`, llamado justo después con el mismo
		// contacto, no tenga que redactar de nuevo ni adivinar esos valores.
		let lastDraft: {
			hook: string;
			vector: string;
			idioma: string;
		} | null = null;

		const draftQueueImpl = createDraftQueueWorkflow({
			async ownerOf(contactId) {
				const { tenantId } = draftQueueCtx as {
					tenantId: string;
					runId: string;
				};
				const contact = await outreach.findContactById(tenantId, contactId);
				return contact?.ownerUserId ?? null;
			},
			async quotaFor(executorUserId) {
				const { tenantId } = draftQueueCtx as {
					tenantId: string;
					runId: string;
				};
				const executor = await outreach.loadExecutor(tenantId, executorUserId);
				return executor?.dailyQuota ?? 0;
			},
			async queuedToday(executorUserId) {
				const { tenantId } = draftQueueCtx as {
					tenantId: string;
					runId: string;
				};
				const tenant = await outreach.loadTenantOutreach(tenantId);
				const since = dayStart(tenant?.config.timezone ?? "UTC", new Date());
				return outreach.countQueuedToday(tenantId, executorUserId, since);
			},
			async listReady() {
				const { tenantId } = draftQueueCtx as {
					tenantId: string;
					runId: string;
				};
				return outreach.listContactsReadyToDraft(tenantId, new Date());
			},
			async draft(contactId) {
				const { tenantId, runId } = draftQueueCtx as {
					tenantId: string;
					runId: string;
				};
				const contact = await outreach.findContactById(tenantId, contactId);
				if (!contact?.ownerUserId) {
					return refuse(
						"sin_dueno",
						`el contacto ${contactId} no tiene ejecutor asignado`,
					);
				}
				const caller: Caller = {
					tenantId,
					userId: contact.ownerUserId,
					role: "tenant_member",
					email: "",
				};
				const brain = await brainForTenant(tenantId);
				const signal = AbortSignal.timeout(ITEM_TIMEOUT_MS);
				const result = await draftMessage(
					{ caller, contactKey: contact.contactKey, kind: "msg1" },
					{
						store: outreach,
						loadCanon: (slug) => loadCanon(brain, slug),
						generate: metered(
							(model: string, system: string, prompt: string) =>
								generateDraft(model, system, prompt, {
									generateText,
									abortSignal: signal,
								}),
							{
								model: (model) => model,
								record,
								base: {
									tenantId,
									runId,
									workflow: "draft-queue",
									node: "outreach/draft",
								},
							},
						),
						now: () => new Date(),
					},
				);
				if (!result.ok)
					return { ok: false, reason: result.reason, message: result.message };
				lastDraft = {
					hook: result.hook,
					vector: result.vector,
					idioma: result.idioma,
				};
				return {
					ok: true,
					subject: result.subject,
					body: result.body,
					ancla: result.ancla,
				};
			},
			async verify(ancla) {
				const { tenantId, runId } = draftQueueCtx as {
					tenantId: string;
					runId: string;
				};
				const signal = AbortSignal.timeout(ITEM_TIMEOUT_MS);
				return verifyFact(ancla, {
					// verifyFact solo quiere el texto (o null si no se pudo leer): la
					// forma completa de WebPageResult es lo que necesita research, no
					// esto.
					async readPage(url) {
						const result = await fetchPublicPage(url, {
							resolveHost,
							fetchImpl: (input, init) =>
								fetch(input, {
									...init,
									signal: init?.signal
										? AbortSignal.any([init.signal, signal])
										: signal,
								}),
						});
						return result.ok ? result.page.text : null;
					},
					evaluate: metered(
						(args: Parameters<typeof runEvaluation>[0]) =>
							runEvaluation(args, { evaluate: experimental_evaluate }),
						{
							model: (args) => args.model,
							record,
							base: {
								tenantId,
								runId,
								workflow: "draft-queue",
								node: "outreach/verify-fact",
							},
						},
					),
				});
			},
			async queue(contactId, drafted) {
				const { tenantId } = draftQueueCtx as {
					tenantId: string;
					runId: string;
				};
				const contact = await outreach.findContactById(tenantId, contactId);
				if (!contact?.ownerUserId) {
					return refuse(
						"sin_dueno",
						`el contacto ${contactId} no tiene ejecutor asignado`,
					);
				}
				const extra = lastDraft;
				lastDraft = null;
				const caller: Caller = {
					tenantId,
					userId: contact.ownerUserId,
					role: "tenant_member",
					email: "",
				};
				const brain = await brainForTenant(tenantId);
				return queueTouch(
					{
						caller,
						contactKey: contact.contactKey,
						kind: "msg1",
						subject: drafted.subject,
						body: drafted.body,
						hook: extra?.hook ?? contact.hook ?? "",
						vector: extra?.vector ?? contact.vector ?? "",
						idioma: extra?.idioma ?? contact.idioma ?? "",
						ancla: drafted.ancla,
					},
					{
						store: outreach,
						crm: null,
						loadCanon: (slug) => loadCanon(brain, slug),
						now: () => new Date(),
					},
				);
			},
		});

		const draftQueue = {
			seed: draftQueueImpl.seed
				? async (tenantId: string, now: Date) => {
						draftQueueCtx = { tenantId, runId: "seed" };
						return draftQueueImpl.seed?.(tenantId, now) ?? [];
					}
				: undefined,
			async runItem(
				item: Parameters<typeof draftQueueImpl.runItem>[0],
				ctx: Parameters<typeof draftQueueImpl.runItem>[1],
			) {
				draftQueueCtx = { tenantId: ctx.tenantId, runId: ctx.runId };
				return draftQueueImpl.runItem(item, ctx);
			},
		};

		const outcomes = await runDispatch({
			agent: AGENT,
			store: createSupabaseWorkflowStore(admin),
			async listTenants() {
				// En paralelo: este tiempo sale del presupuesto del tick, y cada
				// carga es independiente. allSettled conserva el orden de salida de
				// listActiveTenants (no el de resolución) y aísla el fallo de un
				// tenant sin frenar a los demás, igual que el for secuencial de antes.
				const active = await outreach.listActiveTenants();
				const loaded = await Promise.allSettled(
					active.map((tenant) => outreach.loadTenantOutreach(tenant.id)),
				);
				const tenants: DispatchTenant[] = [];
				loaded.forEach((settled, i) => {
					const tenant = active[i];
					if (settled.status === "rejected") {
						console.error(
							`dispatch: no pude cargar ${tenant.slug}:`,
							settled.reason,
						);
						return;
					}
					// Sin el agente de outreach habilitado no hay workflows de outreach
					// que correr para ese tenant.
					if (settled.value)
						tenants.push({
							...tenant,
							timezone: settled.value.config.timezone,
						});
				});
				return tenants;
			},
			impls: {
				"refresh-fichas": createRefreshFichas({ store: outreach }),
				"target-search": targetSearch,
				"icp-scoring": createIcpScoringWorkflow(),
				"contact-enrichment": contactEnrichment,
				"draft-queue": draftQueue,
			},
			nodes: {
				"outreach/research": research,
				"outreach/icp-score": icpScore,
			},
			now: () => new Date(),
		});

		for (const o of outcomes) {
			if (o.outcome === "corrida" && o.result) {
				console.log(
					`dispatch: ${o.tenant}/${o.workflow}: ${o.result.status}, ${o.result.claimed} reclamado(s) (${o.result.ok} ok, ${o.result.refused} rechazado(s), ${o.result.failed} fallido(s)), cortó por ${o.result.stoppedBy}`,
				);
			} else if (o.outcome === "error" || o.outcome === "config_invalida") {
				console.error(
					`dispatch: ${o.tenant}/${o.workflow ?? "-"}: ${o.outcome}: ${o.error}`,
				);
			}
		}
	},
});
