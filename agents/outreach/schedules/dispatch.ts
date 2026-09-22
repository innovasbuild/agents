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
import { refuse } from "../../../lib/outreach/result";
import { runEvaluation } from "../../../lib/outreach/services/evaluate";
import { generateResearch } from "../../../lib/outreach/services/generate-research";
import { scoreContact } from "../../../lib/outreach/services/icp-score";
import { researchAccount } from "../../../lib/outreach/services/research";
import { searchTargetsPage } from "../../../lib/outreach/services/target-search";
import { createSupabaseOutreachStore } from "../../../lib/outreach/store";
import { fetchPublicPage, resolveHost } from "../../../lib/outreach/web-page";
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
