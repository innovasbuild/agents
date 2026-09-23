import { describe, expect, it } from "vitest";
import { outreachEvent } from "@/lib/outreach/events";
import { isNoResponse, NO_RESPONSE_AFTER_DAYS } from "@/lib/outreach/stage";
import type { FakeStore } from "./fake-store";
import { createFakeStore, OTHER_USER, TENANT, USER } from "./fake-store";

/** Un contacto vencido real siempre tiene ejecutor con lectura de Gmail: sin
 * grant de lectura nadie está escuchando sus respuestas, y ahí el carril de
 * follow-ups no corre (simetría con listContactsWithThread). */
function conEscucha(store: FakeStore, userId = USER): FakeStore {
	const executor = store.executors.find((e) => e.userId === userId);
	if (executor) executor.gmailReadAuthorizedAt = "2026-09-01T00:00:00Z";
	else
		store.executors.push({
			tenantId: TENANT,
			userId,
			slug: userId,
			crmOwnerId: null,
			dailyQuota: 30,
			gmailAuthorizedAt: "2026-09-01T00:00:00Z",
			gmailReadAuthorizedAt: "2026-09-01T00:00:00Z",
			displayName: null,
			title: null,
			linkedinUrl: null,
		});
	return store;
}

describe("lecturas de los schedules en el fake store", () => {
	it("listContactsWithThread solo trae contactos con gmail_thread_id", async () => {
		const store = createFakeStore();
		store.contacts.push(
			{
				...store.contactSeed(),
				contactKey: "em:con@hilo.test",
				gmailThreadId: "t1",
				ownerUserId: USER,
			},
			{
				...store.contactSeed(),
				contactKey: "em:sin@hilo.test",
				gmailThreadId: null,
				ownerUserId: USER,
			},
		);

		const rows = await store.listContactsWithThread(TENANT, USER);

		expect(rows.map((r) => r.contactKey)).toEqual(["em:con@hilo.test"]);
	});

	it("listDueFollowups excluye a quien ya respondió", async () => {
		const store = conEscucha(createFakeStore());
		const vencido = "2026-09-01T00:00:00Z";
		store.contacts.push(
			{
				...store.contactSeed(),
				contactKey: "em:debe@test.com",
				ownerUserId: USER,
				nextStepAt: vencido,
				touches: 1,
				repliedAt: null,
			},
			{
				...store.contactSeed(),
				contactKey: "em:respondio@test.com",
				ownerUserId: USER,
				nextStepAt: vencido,
				touches: 1,
				repliedAt: vencido,
			},
		);

		const rows = await store.listDueFollowups(
			TENANT,
			new Date("2026-09-19T12:00:00Z"),
		);

		expect(rows.map((r) => r.contactKey)).toEqual(["em:debe@test.com"]);
	});

	it("listDueFollowups excluye a quien ya agotó los tres toques", async () => {
		const store = conEscucha(createFakeStore());
		store.contacts.push({
			...store.contactSeed(),
			contactKey: "em:agotado@test.com",
			ownerUserId: USER,
			nextStepAt: "2026-09-01T00:00:00Z",
			touches: 3,
			repliedAt: null,
		});

		const rows = await store.listDueFollowups(
			TENANT,
			new Date("2026-09-19T12:00:00Z"),
		);

		expect(rows).toEqual([]);
	});

	it("listDueFollowups excluye a quien todavía no vence", async () => {
		const store = conEscucha(createFakeStore());
		store.contacts.push({
			...store.contactSeed(),
			contactKey: "em:futuro@test.com",
			ownerUserId: USER,
			nextStepAt: "2026-10-01T00:00:00Z",
			touches: 1,
			repliedAt: null,
		});

		const rows = await store.listDueFollowups(
			TENANT,
			new Date("2026-09-19T12:00:00Z"),
		);

		expect(rows).toEqual([]);
	});

	// M1: los dos carriles operan sobre las mismas filas pero entraban por
	// universos distintos. Si no puedo escuchar, no sigo tocando: encolarle un
	// follow-up a alguien cuyas respuestas nadie lee es mandar a ciegas.
	it("listDueFollowups excluye al contacto cuyo ejecutor no tiene lectura de Gmail", async () => {
		const store = conEscucha(createFakeStore());
		store.executors.push({
			tenantId: TENANT,
			userId: OTHER_USER,
			slug: "sin_escucha",
			crmOwnerId: null,
			dailyQuota: 30,
			gmailAuthorizedAt: "2026-09-01T00:00:00Z",
			gmailReadAuthorizedAt: null,
			displayName: null,
			title: null,
			linkedinUrl: null,
		});
		store.contacts.push(
			{
				...store.contactSeed(),
				contactKey: "em:escuchado@test.com",
				ownerUserId: USER,
				nextStepAt: "2026-09-01T00:00:00Z",
				touches: 1,
				repliedAt: null,
			},
			{
				...store.contactSeed(),
				contactKey: "em:a_ciegas@test.com",
				ownerUserId: OTHER_USER,
				nextStepAt: "2026-09-01T00:00:00Z",
				touches: 1,
				repliedAt: null,
			},
		);

		const rows = await store.listDueFollowups(
			TENANT,
			new Date("2026-09-19T12:00:00Z"),
		);

		expect(rows.map((r) => r.contactKey)).toEqual(["em:escuchado@test.com"]);
	});

	it("listDueFollowups no trae nada si ningún ejecutor del tenant tiene lectura", async () => {
		const store = createFakeStore();
		store.contacts.push({
			...store.contactSeed(),
			contactKey: "em:a_ciegas@test.com",
			ownerUserId: USER,
			nextStepAt: "2026-09-01T00:00:00Z",
			touches: 1,
			repliedAt: null,
		});

		const rows = await store.listDueFollowups(
			TENANT,
			new Date("2026-09-19T12:00:00Z"),
		);

		expect(rows).toEqual([]);
	});

	it("listExhaustedContacts trae a quien agotó los tres toques hace más de NO_RESPONSE_AFTER_DAYS", async () => {
		const store = createFakeStore();
		store.contacts.push({
			...store.contactSeed(),
			contactKey: "em:agotado@test.com",
			touches: 3,
			repliedAt: null,
			firstTouchAt: "2026-08-01T00:00:00Z",
		});

		const rows = await store.listExhaustedContacts(
			TENANT,
			new Date("2026-09-19T12:00:00Z"),
		);

		expect(rows.map((r) => r.contactKey)).toEqual(["em:agotado@test.com"]);
	});

	it("listExhaustedContacts excluye a quien todavía no llega a tres toques", async () => {
		const store = createFakeStore();
		store.contacts.push({
			...store.contactSeed(),
			contactKey: "em:dos_toques@test.com",
			touches: 2,
			repliedAt: null,
			firstTouchAt: "2026-08-01T00:00:00Z",
		});

		const rows = await store.listExhaustedContacts(
			TENANT,
			new Date("2026-09-19T12:00:00Z"),
		);

		expect(rows).toEqual([]);
	});

	it("listExhaustedContacts excluye a quien ya respondió", async () => {
		const store = createFakeStore();
		store.contacts.push({
			...store.contactSeed(),
			contactKey: "em:respondio@test.com",
			touches: 3,
			repliedAt: "2026-08-15T00:00:00Z",
			firstTouchAt: "2026-08-01T00:00:00Z",
		});

		const rows = await store.listExhaustedContacts(
			TENANT,
			new Date("2026-09-19T12:00:00Z"),
		);

		expect(rows).toEqual([]);
	});

	// M2: `isNoResponse()` es la definición canónica de "agotado" y estaba
	// muerta — la store la había reimplementado en SQL, con el borde distinto
	// (`<` estricto vs `>=`). Dos copias de la misma regla divergen tarde o
	// temprano: ahora el SQL es un prefiltro y la palabra final la tiene
	// `isNoResponse`. El instante exacto de los 14 días es donde se veía la
	// diferencia.
	it("listExhaustedContacts usa isNoResponse: a los NO_RESPONSE_AFTER_DAYS justos ya está agotado", async () => {
		const now = new Date("2026-09-19T12:00:00Z");
		const justo = new Date(
			now.getTime() - NO_RESPONSE_AFTER_DAYS * 86_400_000,
		).toISOString();
		const store = createFakeStore();
		store.contacts.push({
			...store.contactSeed(),
			contactKey: "em:justo@test.com",
			touches: 3,
			repliedAt: null,
			firstTouchAt: justo,
		});

		const rows = await store.listExhaustedContacts(TENANT, now);

		expect(rows.map((r) => r.contactKey)).toEqual(["em:justo@test.com"]);
		// Y la definición canónica dice lo mismo sobre esa misma fila.
		expect(
			isNoResponse({
				touches: 3,
				firstTouchAt: new Date(justo),
				repliedAt: null,
				now,
			}),
		).toBe(true);
	});

	it("listExhaustedContacts excluye a quien todavía no cumplió NO_RESPONSE_AFTER_DAYS desde el primer toque", async () => {
		const store = createFakeStore();
		store.contacts.push({
			...store.contactSeed(),
			contactKey: "em:reciente@test.com",
			touches: 3,
			repliedAt: null,
			firstTouchAt: "2026-09-18T00:00:00Z",
		});

		const rows = await store.listExhaustedContacts(
			TENANT,
			new Date("2026-09-19T12:00:00Z"),
		);

		expect(rows).toEqual([]);
	});

	it("listExhaustedContacts excluye a quien ya tiene un evento oportunidad_frenada (idempotencia del freno)", async () => {
		const store = createFakeStore();
		store.contacts.push({
			...store.contactSeed(),
			contactKey: "em:ya_frenado@test.com",
			touches: 3,
			repliedAt: null,
			firstTouchAt: "2026-08-01T00:00:00Z",
		});
		store.events.push(
			outreachEvent({
				tenant_id: TENANT,
				actor_user_id: null,
				contact_key: "em:ya_frenado@test.com",
				type: "oportunidad_frenada",
				summary: "tres toques sin respuesta, con deal abierto",
				payload: {},
			}),
		);

		const rows = await store.listExhaustedContacts(
			TENANT,
			new Date("2026-09-19T12:00:00Z"),
		);

		expect(rows).toEqual([]);
	});

	it("listContactsWithThread filtra por owner_user_id", async () => {
		const store = createFakeStore();
		store.contacts.push(
			{
				...store.contactSeed(),
				contactKey: "em:del@user.test",
				gmailThreadId: "t1",
				ownerUserId: USER,
			},
			{
				...store.contactSeed(),
				contactKey: "em:del@otro.test",
				gmailThreadId: "t2",
				ownerUserId: OTHER_USER,
			},
		);

		const rows = await store.listContactsWithThread(TENANT, USER);

		expect(rows.map((r) => r.contactKey)).toEqual(["em:del@user.test"]);
	});

	it("listExecutorsWithGmailRead solo trae quienes tienen gmail_read_authorized_at", async () => {
		const store = createFakeStore();
		store.executors.push({
			tenantId: TENANT,
			userId: "user-3",
			slug: "solo_envio",
			crmOwnerId: null,
			dailyQuota: 30,
			gmailAuthorizedAt: "2026-09-01T00:00:00Z",
			gmailReadAuthorizedAt: null,
			displayName: null,
			title: null,
			linkedinUrl: null,
		});
		// El ejecutor USER tiene gmail_read_authorized_at = null por defecto

		const rows = await store.listExecutorsWithGmailRead(TENANT);

		expect(rows).toEqual([]);
	});

	it("listExecutorsWithGmailRead trae ejecutores con permisos de lectura", async () => {
		const store = createFakeStore();
		store.executors[0].gmailReadAuthorizedAt = "2026-09-01T00:00:00Z";

		const rows = await store.listExecutorsWithGmailRead(TENANT);

		expect(rows.map((r) => r.userId)).toEqual([USER]);
	});

	it("listActiveTenants solo trae tenants activos", async () => {
		const store = createFakeStore();
		// Agregar un tenant inactivo
		store.tenants.set("inactive-tenant", store.tenants.get(TENANT)!);
		store.tenantActive.set("inactive-tenant", false);

		const rows = await store.listActiveTenants();

		expect(rows.map((r) => r.id)).toEqual([TENANT]);
	});

	it("countRecentReplies cuenta contactos en respuesta_neutra con evento respuesta desde `since`", async () => {
		const store = createFakeStore();
		store.contacts.push(
			{
				...store.contactSeed(),
				contactKey: "em:respondio@test.com",
				stage: "respuesta_neutra",
			},
			{
				...store.contactSeed(),
				contactKey: "em:no_respondio@test.com",
				stage: "sin_respuesta",
			},
		);
		await store.insertEvents([
			outreachEvent({
				tenant_id: TENANT,
				actor_user_id: null,
				contact_key: "em:respondio@test.com",
				type: "respuesta",
				summary: "Gracias, lo vemos la semana que viene.",
				payload: {},
			}),
		]);

		const count = await store.countRecentReplies(
			TENANT,
			new Date("2000-01-01T00:00:00Z"),
		);

		expect(count).toBe(1);
	});

	it("countRecentReplies no cuenta a quien respondió pero ya no está en respuesta_neutra", async () => {
		const store = createFakeStore();
		store.contacts.push({
			...store.contactSeed(),
			contactKey: "em:avanzo@test.com",
			stage: "en_conversacion",
		});
		await store.insertEvents([
			outreachEvent({
				tenant_id: TENANT,
				actor_user_id: null,
				contact_key: "em:avanzo@test.com",
				type: "respuesta",
				summary: "Dale, hablemos.",
				payload: {},
			}),
		]);

		const count = await store.countRecentReplies(
			TENANT,
			new Date("2000-01-01T00:00:00Z"),
		);

		expect(count).toBe(0);
	});

	it("countRecentReplies excluye eventos anteriores a `since`", async () => {
		const store = createFakeStore();
		store.contacts.push({
			...store.contactSeed(),
			contactKey: "em:respondio@test.com",
			stage: "respuesta_neutra",
		});
		await store.insertEvents([
			outreachEvent({
				tenant_id: TENANT,
				actor_user_id: null,
				contact_key: "em:respondio@test.com",
				type: "respuesta",
				summary: "Gracias, lo vemos la semana que viene.",
				payload: {},
			}),
		]);

		const count = await store.countRecentReplies(
			TENANT,
			new Date("2030-01-01T00:00:00Z"),
		);

		expect(count).toBe(0);
	});

	it("countRecentReplies no cruza tenants", async () => {
		const store = createFakeStore();
		store.contacts.push({
			...store.contactSeed(),
			contactKey: "em:respondio@test.com",
			stage: "respuesta_neutra",
		});
		await store.insertEvents([
			outreachEvent({
				tenant_id: TENANT,
				actor_user_id: null,
				contact_key: "em:respondio@test.com",
				type: "respuesta",
				summary: "Gracias, lo vemos la semana que viene.",
				payload: {},
			}),
		]);

		const count = await store.countRecentReplies(
			"otro-tenant",
			new Date("2000-01-01T00:00:00Z"),
		);

		expect(count).toBe(0);
	});

	it("countStalled cuenta eventos oportunidad_frenada desde `since`", async () => {
		const store = createFakeStore();
		await store.insertEvents([
			outreachEvent({
				tenant_id: TENANT,
				actor_user_id: null,
				contact_key: "em:agotado@test.com",
				type: "oportunidad_frenada",
				summary: "tres toques sin respuesta, con deal abierto",
				payload: {},
			}),
			outreachEvent({
				tenant_id: TENANT,
				actor_user_id: null,
				contact_key: "em:otro_agotado@test.com",
				type: "oportunidad_frenada",
				summary: "tres toques sin respuesta, con deal abierto",
				payload: {},
			}),
		]);

		const count = await store.countStalled(
			TENANT,
			new Date("2000-01-01T00:00:00Z"),
		);

		expect(count).toBe(2);
	});

	it("countStalled ignora eventos de otro tipo", async () => {
		const store = createFakeStore();
		await store.insertEvents([
			outreachEvent({
				tenant_id: TENANT,
				actor_user_id: null,
				contact_key: "em:respondio@test.com",
				type: "respuesta",
				summary: "Gracias, lo vemos la semana que viene.",
				payload: {},
			}),
		]);

		const count = await store.countStalled(
			TENANT,
			new Date("2000-01-01T00:00:00Z"),
		);

		expect(count).toBe(0);
	});

	it("countStalled excluye eventos anteriores a `since`", async () => {
		const store = createFakeStore();
		await store.insertEvents([
			outreachEvent({
				tenant_id: TENANT,
				actor_user_id: null,
				contact_key: "em:agotado@test.com",
				type: "oportunidad_frenada",
				summary: "tres toques sin respuesta, con deal abierto",
				payload: {},
			}),
		]);

		const count = await store.countStalled(
			TENANT,
			new Date("2030-01-01T00:00:00Z"),
		);

		expect(count).toBe(0);
	});

	it("countStalled no cruza tenants", async () => {
		const store = createFakeStore();
		await store.insertEvents([
			outreachEvent({
				tenant_id: TENANT,
				actor_user_id: null,
				contact_key: "em:agotado@test.com",
				type: "oportunidad_frenada",
				summary: "tres toques sin respuesta, con deal abierto",
				payload: {},
			}),
		]);

		const count = await store.countStalled(
			"otro-tenant",
			new Date("2000-01-01T00:00:00Z"),
		);

		expect(count).toBe(0);
	});

	// Hallazgo de la review de Task 20: first_touch_at solo se estampa en el
	// envío real (send.ts), nunca al encolar (queueTouch no lo toca). Sin este
	// chequeo contra queue_items, el seed() diario re-sembraba (y regastaba
	// draftMessage + verifyFact) a un contacto cuya pieza seguía pending o
	// approved esperando el click humano en /cola.
	it("listContactsReadyToDraft excluye a quien ya tiene una pieza pending esperando en la cola", async () => {
		const store = createFakeStore();
		const calificado = (contactKey: string) => ({
			...store.contactSeed(),
			contactKey,
			icp: {
				encaje_empresa: null,
				rol_decisor: null,
				excluir: null,
				lane: "calificado" as const,
				reason: "test",
				model: "test",
				revision: "2026-09-01",
				judged_at: "2026-09-01T00:00:00Z",
			},
		});
		const conPieza = calificado("em:con_pieza@test.com");
		const sinPieza = calificado("em:sin_pieza@test.com");
		store.contacts.push(conPieza, sinPieza);
		await store.insertQueueItem({
			tenantId: TENANT,
			contactId: conPieza.id,
			contactKey: conPieza.contactKey,
			executorUserId: USER,
			kind: "msg1",
			toEmail: "con_pieza@test.com",
			subject: "Asunto",
			body: "Cuerpo",
			hook: "h1",
			vector: "v1",
			idioma: "es_ar",
			ancla: { hecho: "Abrió planta", fuente: "https://acme.test/n" },
			draftOriginal: { subject: "Asunto", body: "Cuerpo" },
			gateResult: { status: "ok", violations: [], warnings: [], notes: [] },
			replyToMessageId: null,
			gmailThreadId: null,
		});

		const rows = await store.listContactsReadyToDraft(
			TENANT,
			new Date("2026-09-19T12:00:00Z"),
		);

		expect(rows.map((r) => r.contactKey)).toEqual(["em:sin_pieza@test.com"]);
	});
});
