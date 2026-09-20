import { describe, expect, it } from "vitest";
import { outreachEvent } from "@/lib/outreach/events";
import { createFakeStore, OTHER_USER, TENANT, USER } from "./fake-store";

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
		const store = createFakeStore();
		const vencido = "2026-09-01T00:00:00Z";
		store.contacts.push(
			{
				...store.contactSeed(),
				contactKey: "em:debe@test.com",
				nextStepAt: vencido,
				touches: 1,
				repliedAt: null,
			},
			{
				...store.contactSeed(),
				contactKey: "em:respondio@test.com",
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
		const store = createFakeStore();
		store.contacts.push({
			...store.contactSeed(),
			contactKey: "em:agotado@test.com",
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
		const store = createFakeStore();
		store.contacts.push({
			...store.contactSeed(),
			contactKey: "em:futuro@test.com",
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
});
