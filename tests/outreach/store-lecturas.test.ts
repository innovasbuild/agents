import { describe, expect, it } from "vitest";
import { createFakeStore, TENANT, USER } from "./fake-store";

describe("lecturas de los schedules en el fake store", () => {
	it("listContactsWithThread solo trae contactos con gmail_thread_id", async () => {
		const store = createFakeStore();
		store.contacts.push(
			{ ...store.contactSeed(), contactKey: "em:con@hilo.test", gmailThreadId: "t1", ownerUserId: USER },
			{ ...store.contactSeed(), contactKey: "em:sin@hilo.test", gmailThreadId: null, ownerUserId: USER },
		);

		const rows = await store.listContactsWithThread(TENANT, USER);

		expect(rows.map((r) => r.contactKey)).toEqual(["em:con@hilo.test"]);
	});

	it("listDueFollowups excluye a quien ya respondió", async () => {
		const store = createFakeStore();
		const vencido = "2026-09-01T00:00:00Z";
		store.contacts.push(
			{ ...store.contactSeed(), contactKey: "em:debe@test.com", nextStepAt: vencido, touches: 1, repliedAt: null },
			{ ...store.contactSeed(), contactKey: "em:respondio@test.com", nextStepAt: vencido, touches: 1, repliedAt: vencido },
		);

		const rows = await store.listDueFollowups(TENANT, new Date("2026-09-19T12:00:00Z"));

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

		const rows = await store.listDueFollowups(TENANT, new Date("2026-09-19T12:00:00Z"));

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

		const rows = await store.listDueFollowups(TENANT, new Date("2026-09-19T12:00:00Z"));

		expect(rows).toEqual([]);
	});
});
