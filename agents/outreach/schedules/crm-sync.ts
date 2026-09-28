// Cableado del sync entrante de HubSpot. Toda la lógica vive en
// lib/outreach/services/crm-sync.ts, con dependencias inyectadas y testeada;
// acá solo se arman las deps reales y se resuelve el token — mismo criterio
// que morning-sweep.ts (docs/superpowers/specs/2026-09-27-hubspot-crm-sync-design.md §4.6).
//
// Imports relativos y no "@/": eve no resuelve los paths de tsconfig en los
// módulos que compila (mismo motivo que morning-sweep.ts).
import { defineSchedule } from "eve/schedules";
import {
	isConnectAuthError,
	tokenForSubject,
} from "../../../lib/connectors/auth";
import { hasEnabledBinding } from "../../../lib/connectors/bindings";
import { createHubSpotAdapter } from "../../../lib/connectors/crm/hubspot-adapter";
import { HUBSPOT_CONNECTOR_UID } from "../../../lib/connectors/platform";
import { outreachEvent } from "../../../lib/outreach/events";
import { runCrmSync } from "../../../lib/outreach/services/crm-sync";
import { takeScheduleLock } from "../../../lib/outreach/services/sweep";
import { createSupabaseOutreachStore } from "../../../lib/outreach/store";
import { createAdminClient } from "../../../lib/supabase/admin";

const AGENT = "outreach";
const SCHEDULE = "crm-sync";

/** scheduleKeyFor (sweep.ts) trunca a fecha, así que no sirve acá: esto corre
 * dos veces por día y con esa granularidad la segunda corrida del día
 * chocaría contra el lock de la primera. La clave local trunca a fecha+hora
 * (ISO 8601 hasta el bloque de hora, ej. "2026-09-27T12"): un slot por hora
 * alcanza para evitar dos corridas superpuestas del mismo disparo de cron,
 * sin bloquear la corrida de otro horario del mismo día. */
function hourlyScheduleKey(now: Date): string {
	return `${SCHEDULE}:${now.toISOString().slice(0, 13)}`;
}

export default defineSchedule({
	// 9:00 y 18:00 de Argentina (UTC-3) ≈ 12:00 y 21:00 UTC. Vercel evalúa cron
	// en UTC, igual que morning-sweep.
	cron: "0 12,21 * * *",
	async run() {
		const admin = createAdminClient();
		const store = createSupabaseOutreachStore(admin);
		const now = new Date();
		const scheduleKey = hourlyScheduleKey(now);

		const tenants = await store.listActiveTenants();
		const anyTenant = tenants[0];
		if (!anyTenant) return;

		const gotLock = await takeScheduleLock(
			{
				insertRun: async (row) => {
					const { error } = await admin.from("runs").insert(row);
					return { error };
				},
			},
			{ scheduleKey, tenantId: anyTenant.id, agent: AGENT },
		);
		if (!gotLock) return;

		for (const tenant of tenants) {
			// Todo el cuerpo del tenant va adentro de este try/catch — no solo la
			// llamada a runCrmSync. hasEnabledBinding, listExecutorsWithCrmOwner y
			// el loop de tokenForSubject también pueden tirar, y un tenant que
			// falla ahí no puede frenar la corrida de los demás (spec §2 criterio 5).
			try {
				if (!(await hasEnabledBinding(tenant.id, "crm", "hubspot"))) continue;

				const executors = await store.listExecutorsWithCrmOwner(tenant.id);
				let token: string | null = null;
				for (const executor of executors) {
					try {
						const { token: t } = await tokenForSubject(HUBSPOT_CONNECTOR_UID, {
							tenantId: tenant.id,
							userId: executor.userId,
							issuer: process.env.NEXT_PUBLIC_SUPABASE_URL,
						});
						token = t;
						break;
					} catch (error) {
						if (!isConnectAuthError(error)) throw error;
					}
				}

				if (!token) {
					await store.insertEvents([
						outreachEvent({
							tenant_id: tenant.id,
							actor_user_id: null,
							contact_key: null,
							channel: null,
							type: "crm_sync_pendiente",
							summary: "sin grant de HubSpot vigente para ningún ejecutor",
							payload: {},
						}),
					]);
					continue;
				}

				// Sin withReauth: un schedule no tiene ctx.requireAuth para pausar el
				// turno — un 401 acá es "grant vencido", mismo camino que "ningún
				// ejecutor sirve" arriba.
				const crm = createHubSpotAdapter(token);
				const result = await runCrmSync(tenant.id, {
					listContactsWithCrmId: (id) => store.listContactsWithCrmId(id),
					listExecutorsWithCrmOwner: (id) =>
						store.listExecutorsWithCrmOwner(id),
					updateContact: (tenantId, id, patch) =>
						store.updateContact(tenantId, id, patch),
					insertEvents: (rows) => store.insertEvents(rows),
					crm,
					now: () => new Date(),
				});
				console.log(`${SCHEDULE}: tenant ${tenant.slug}`, result);
			} catch (error) {
				console.error(`${SCHEDULE}: tenant ${tenant.slug}:`, error);
			}
		}
	},
});
