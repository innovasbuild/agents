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

		const research: ResearchNode = ({ tenantId, runId, domain, name }) => {
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
								workflow: "refresh-fichas",
								node: "outreach/research",
							},
						},
					),
				},
			);
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
