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
import { generateText } from "ai";
import { defineSchedule } from "eve/schedules";
import { generateResearch } from "../../../lib/outreach/services/generate-research";
import { researchAccount } from "../../../lib/outreach/services/research";
import { createSupabaseOutreachStore } from "../../../lib/outreach/store";
import { fetchPublicPage, resolveHost } from "../../../lib/outreach/web-page";
import {
	createRefreshFichas,
	type ResearchNode,
} from "../../../lib/outreach/workflows/refresh-fichas";
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

		const research: ResearchNode = ({ tenantId, runId, domain, name }) =>
			researchAccount(
				{ tenantId, userId: null, domain, name },
				{
					store: outreach,
					now: () => new Date(),
					readPage: (url) =>
						fetchPublicPage(url, { fetchImpl: fetch, resolveHost }),
					generate: metered(
						(args: Parameters<typeof generateResearch>[0]) =>
							generateResearch(args, {
								generateText,
								// El runner mira el reloj antes de reclamar, no durante un
								// ítem: sin este tope, un research lento al final del tick
								// pasa el timeout de la función.
								abortSignal: AbortSignal.timeout(ITEM_TIMEOUT_MS),
							}),
						{
							model: (args) => args.model,
							record,
							base: {
								tenantId,
								runId,
								workflow: "refresh-fichas",
								node: "outreach/research",
							},
						},
					),
				},
			);

		const outcomes = await runDispatch({
			agent: AGENT,
			store: createSupabaseWorkflowStore(admin),
			async listTenants() {
				const tenants: DispatchTenant[] = [];
				for (const tenant of await outreach.listActiveTenants()) {
					try {
						// Sin el agente de outreach habilitado no hay workflows de
						// outreach que correr para ese tenant.
						const loaded = await outreach.loadTenantOutreach(tenant.id);
						if (loaded)
							tenants.push({ ...tenant, timezone: loaded.config.timezone });
					} catch (error) {
						console.error(`dispatch: no pude cargar ${tenant.slug}:`, error);
					}
				}
				return tenants;
			},
			impls: { "refresh-fichas": createRefreshFichas({ store: outreach }) },
			nodes: { "outreach/research": research },
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
