// Cableado del barrido de la mañana. Toda la lógica vive en
// lib/outreach/services/sweep.ts, con dependencias inyectadas y testeada; acá
// solo se arman las deps reales, se toma el lock y se hace el handoff.
//
// Imports relativos y no "@/": eve no resuelve los paths de tsconfig en los
// módulos que compila (mismo motivo que lib/agents/channel-context.ts).
import { defineSchedule } from "eve/schedules";
import { tokenForSubject } from "../../../lib/connectors/auth";
import { GOOGLE_CONNECTOR_UID } from "../../../lib/connectors/platform";
import { fetchThread, findByRfc822Id } from "../../../lib/gmail/read";
import { GMAIL_SCOPES } from "../../../lib/gmail/send";
import {
	needsHandoff,
	runMorningSweep,
	type SweepExecutor,
	type SweepStore,
	type SweepTenantResult,
	scheduleKeyFor,
	takeScheduleLock,
} from "../../../lib/outreach/services/sweep";
import { createSupabaseOutreachStore } from "../../../lib/outreach/store";
import { createAdminClient } from "../../../lib/supabase/admin";
import eve from "../channels/eve";

const AGENT = "outreach";
const SCHEDULE = "morning-sweep";

/**
 * El prompt no trae las respuestas: el agente las lee con `read_replies`. Así
 * el prompt queda corto y la fuente de verdad sigue siendo la base, no el
 * texto de un mensaje que nadie va a poder auditar después.
 */
function handoffPrompt(tenant: SweepTenantResult): string {
	const extra: string[] = [];
	if (tenant.rebotes > 0) extra.push(`${tenant.rebotes} rebote(s)`);
	if (tenant.respuestasAvanzadas > 0) {
		extra.push(
			`${tenant.respuestasAvanzadas} respuesta(s) de gente que ya venía conversando`,
		);
	}
	if (tenant.trabadas > 0) extra.push(`${tenant.trabadas} pieza(s) trabada(s)`);
	if (tenant.contactosFallidos > 0) {
		extra.push(`${tenant.contactosFallidos} hilo(s) que Gmail no dejó leer`);
	}
	if (tenant.ejecutoresFallidos.length > 0) {
		extra.push(`sin Gmail: ${tenant.ejecutoresFallidos.join(", ")}`);
	}

	return [
		`El barrido de la mañana encontró ${tenant.respuestas} respuesta(s) nueva(s) sin clasificar.`,
		"Traelas con la tool `read_replies` y clasificá cada una siguiendo la skill `outreach-escucha`.",
		extra.length > 0 ? `El barrido además dejó: ${extra.join(" · ")}.` : null,
		"Cuando termines, resumí en este mismo hilo qué encontraste y qué moviste.",
	]
		.filter((line): line is string => line !== null)
		.join(" ");
}

/** El email del ejecutor no está en `executors`: sale de `auth.users`. Sin él
 * no se puede saber qué mensajes del hilo son nuestros, y confundirlos
 * registraría nuestro propio mail como si fuera la respuesta del otro. Acá va
 * en `null` y el que decide es `runSweep`, que lo anota en `ejecutoresFallidos`
 * — saltearlo en silencio dejaría un buzón sin barrer noche tras noche sin que
 * el resumen lo diga nunca. */
function buildStore(): SweepStore {
	const admin = createAdminClient();
	const store = createSupabaseOutreachStore(admin);

	return {
		listActiveTenants: () => store.listActiveTenants(),
		async listExecutorsWithGmailRead(tenantId) {
			const rows = await store.listExecutorsWithGmailRead(tenantId);
			const executors: SweepExecutor[] = [];
			for (const row of rows) {
				const { data, error } = await admin.auth.admin.getUserById(row.userId);
				if (error) {
					console.error(
						`${SCHEDULE}: no pude leer el usuario ${row.slug ?? row.userId}:`,
						error.message,
					);
				}
				executors.push({
					tenantId: row.tenantId,
					userId: row.userId,
					slug: row.slug,
					email: data?.user?.email ?? null,
				});
			}
			return executors;
		},
		listContactsWithThread: (tenantId, ownerUserId) =>
			store.listContactsWithThread(tenantId, ownerUserId),
		listKnownInboundIds: (tenantId, contactKey) =>
			store.listKnownInboundIds(tenantId, contactKey),
		listQueue: (tenantId, executorUserId, statuses) =>
			store.listQueue(tenantId, executorUserId, statuses),
		insertEvents: (rows) => store.insertEvents(rows),
		updateContact: (tenantId, id, patch) =>
			store.updateContact(tenantId, id, patch),
		transitionQueueItem: (tenantId, id, from, patch) =>
			store.transitionQueueItem(tenantId, id, from, patch),
	};
}

export default defineSchedule({
	// 7:00 de Argentina. Vercel evalúa cron en UTC.
	cron: "0 10 * * 1-5",
	async run({ to, waitUntil, appAuth }) {
		const admin = createAdminClient();
		const store = buildStore();
		const now = new Date();
		const scheduleKey = scheduleKeyFor(SCHEDULE, now);

		const result = await runMorningSweep({
			store,
			// El lock, una vez por corrida y antes de iterar nada: si ya corrió hoy,
			// runMorningSweep devuelve null sin tocar nada. Los tenants llegan ya
			// listados (runMorningSweep los pide antes de llamar acá) justamente
			// para que un error al listarlos no queme el lock del día.
			async takeLock(tenants) {
				// `runs.tenant_id` es NOT NULL y el lock es global de la corrida:
				// cualquier tenant activo sirve para la FK, la identidad del lock es
				// `schedule_key`.
				const anyTenant = tenants[0];
				if (!anyTenant) return false;
				return await takeScheduleLock(
					{
						insertRun: async (row) => {
							const { error } = await admin.from("runs").insert(row);
							return { error };
						},
					},
					{ scheduleKey, tenantId: anyTenant.id, agent: AGENT },
				);
			},
			async getToken(executor) {
				// GMAIL_SCOPES completo y con issuer: Connect matchea el grant por el
				// conjunto exacto de scopes, y sin issuer el subject no es el mismo
				// que autorizó la persona desde el chat.
				const { token } = await tokenForSubject(
					GOOGLE_CONNECTOR_UID,
					{
						tenantId: executor.tenantId,
						userId: executor.userId,
						issuer: process.env.NEXT_PUBLIC_SUPABASE_URL,
					},
					[...GMAIL_SCOPES],
				);
				return token;
			},
			fetchThread,
			findByRfc822Id,
			now: () => new Date(),
		});

		if (!result) return;

		// OJO, esto HOY NO FUNCIONA y es a propósito que quede escrito así.
		// `to(eve, {})` tira siempre: `eveChannel()` no implementa `receive()` —
		// no expone esa opción (ver EveChannelInput en
		// node_modules/eve/dist/src/eve-channel/types.d.ts) y
		// `invokeChannelReceive` lanza «channel "eve" does not implement
		// receive()». Además `appAuth` no trae `conversationId`, que el hook
		// bind-session exige. El handoff empieza a andar recién cuando exista un
		// canal para los schedules (o cuando la sesión de la mañana la abra la
		// app) — decisión parkeada, no un olvido.
		//
		// Mientras tanto: el catch de abajo se come el error, el barrido queda
		// registrado igual y la persona ve las respuestas en /contactos y en el
		// resumen que abre el chat (spec 03 §8.5).
		for (const tenant of result.tenants) {
			// Si no hay nada que interpretar, no se manda nada.
			if (!needsHandoff(tenant)) continue;
			waitUntil(
				(async () => {
					try {
						await to(eve, {}).send(handoffPrompt(tenant), {
							// El tenant viaja en los attributes: las tools lo leen de ahí
							// (callerFromSession), no del prompt.
							auth: {
								...appAuth,
								attributes: {
									...appAuth.attributes,
									tenantId: tenant.tenantId,
									tenantSlug: tenant.slug,
								},
							},
						});
					} catch (error) {
						// Un handoff que falla no puede borrar lo ya registrado: las
						// respuestas quedaron en la base y salen igual en el resumen que
						// abre el chat (spec 03 §8.5).
						console.error(`${SCHEDULE}: handoff de ${tenant.slug}:`, error);
					}
				})(),
			);
		}
	},
});
