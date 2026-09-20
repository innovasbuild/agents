import { describe, expect, it, vi } from "vitest";
import {
	type DraftAndQueueInput,
	runFollowups,
} from "@/lib/outreach/services/followups";

const contacto = (over: Record<string, unknown> = {}) => ({
	id: "c1",
	tenantId: "t1",
	contactKey: "em:ana@acme.test",
	gmailThreadId: "t1",
	touches: 1,
	repliedAt: null,
	nextStepAt: "2026-09-01T00:00:00Z",
	...over,
});

const deps = (over: Record<string, unknown> = {}) => ({
	store: {
		listActiveTenants: async () => [{ id: "t1", slug: "innovas" }],
		listDueFollowups: async () => [contacto()],
	},
	draftAndQueue: vi.fn(async () => ({ ok: true as const })),
	now: () => new Date("2026-09-19T11:00:00Z"),
	...over,
});

describe("runFollowups", () => {
	it("encola una pieza por cada contacto vencido", async () => {
		const draftAndQueue = vi.fn(async () => ({ ok: true as const }));

		const result = await runFollowups(deps({ draftAndQueue }));

		expect(result.encoladas).toBe(1);
		expect(draftAndQueue).toHaveBeenCalledTimes(1);
	});

	it("el segundo toque es followup_2 y el tercero followup_3", async () => {
		// Anotado (a diferencia de los otros mocks del archivo): sin el tipo del
		// parámetro, vi.fn infer Parameters<T> = [] de un callback sin argumentos,
		// y .mock.calls[N][0] no tipa. No cambia valores ni comportamiento.
		const draftAndQueue = vi.fn(async (_input: DraftAndQueueInput) => ({
			ok: true as const,
		}));

		await runFollowups(
			deps({
				draftAndQueue,
				store: {
					...deps().store,
					listDueFollowups: async () => [
						contacto({ contactKey: "em:uno@test.com", touches: 1 }),
						contacto({ contactKey: "em:dos@test.com", touches: 2 }),
					],
				},
			}),
		);

		expect(draftAndQueue.mock.calls[0][0].kind).toBe("followup_2");
		expect(draftAndQueue.mock.calls[1][0].kind).toBe("followup_3");
	});

	it("saltea al contacto sin hilo en vez de abrir una conversación nueva", async () => {
		const draftAndQueue = vi.fn(async () => ({ ok: true as const }));

		const result = await runFollowups(
			deps({
				draftAndQueue,
				store: {
					...deps().store,
					listDueFollowups: async () => [contacto({ gmailThreadId: null })],
				},
			}),
		);

		expect(result.encoladas).toBe(0);
		expect(result.salteadas[0].motivo).toMatch(/hilo/i);
		expect(draftAndQueue).not.toHaveBeenCalled();
	});

	it("un contacto que falla no frena a los demás", async () => {
		const draftAndQueue = vi
			.fn()
			.mockRejectedValueOnce(new Error("gate caído"))
			.mockResolvedValueOnce({ ok: true as const });

		const result = await runFollowups(
			deps({
				draftAndQueue,
				store: {
					...deps().store,
					listDueFollowups: async () => [
						contacto({ contactKey: "em:uno@test.com" }),
						contacto({ contactKey: "em:dos@test.com" }),
					],
				},
			}),
		);

		expect(result.encoladas).toBe(1);
		expect(result.salteadas).toHaveLength(1);
	});

	it("marca oportunidad frenada al contacto agotado que tiene un deal abierto", async () => {
		const insertEvents = vi.fn(async () => {});

		const result = await runFollowups(
			deps({
				store: {
					...deps().store,
					listDueFollowups: async () => [],
					listExhaustedContacts: async () => [
						contacto({
							touches: 3,
							crmId: "c1",
							firstTouchAt: "2026-08-01T00:00:00Z",
						}),
					],
					insertEvents,
				},
				listOpenDeals: async () => [
					{ id: "d1", stage: "decisionmakerboughtin" },
				],
			}),
		);

		expect(result.frenadas).toBe(1);
		expect(insertEvents).toHaveBeenCalled();
	});

	it("un contacto agotado sin deal abierto no se marca como frenado", async () => {
		const result = await runFollowups(
			deps({
				store: {
					...deps().store,
					listDueFollowups: async () => [],
					listExhaustedContacts: async () => [
						contacto({
							touches: 3,
							crmId: "c1",
							firstTouchAt: "2026-08-01T00:00:00Z",
						}),
					],
					insertEvents: vi.fn(async () => {}),
				},
				listOpenDeals: async () => [],
			}),
		);

		expect(result.frenadas).toBe(0);
	});
});
