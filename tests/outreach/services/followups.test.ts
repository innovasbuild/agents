import { describe, expect, it, vi } from "vitest";
import { refuse } from "@/lib/outreach/result";
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
		// Finding 5: una excepción de verdad no se lee igual que un salteo
		// estructural (Refusal). Va con su propio tipo.
		expect(result.salteadas[0].tipo).toBe("excepcion");
	});

	it("un Refusal de queueTouch (pieza_viva) se saltea con su motivo, no revienta la corrida", async () => {
		const draftAndQueue = vi.fn(async (_input: DraftAndQueueInput) =>
			refuse("pieza_viva", "esta persona ya tiene una pieza en la cola"),
		);

		const result = await runFollowups(deps({ draftAndQueue }));

		expect(result.encoladas).toBe(0);
		expect(result.salteadas).toEqual([
			{
				contactKey: "em:ana@acme.test",
				motivo: "esta persona ya tiene una pieza en la cola",
				tipo: "refusal",
			},
		]);
	});

	it("un contacto que ya respondió entre medio (etapa_incompatible) no recibe follow-up", async () => {
		const draftAndQueue = vi.fn(async (_input: DraftAndQueueInput) =>
			refuse(
				"etapa_incompatible",
				"el contacto ya respondió: no corresponde mandarle un follow-up",
			),
		);

		const result = await runFollowups(
			deps({
				draftAndQueue,
				store: {
					...deps().store,
					listDueFollowups: async () => [contacto({ touches: 2 })],
				},
			}),
		);

		expect(result.encoladas).toBe(0);
		expect(result.salteadas[0].motivo).toMatch(/respondió/i);
		expect(result.salteadas[0].tipo).toBe("refusal");
	});

	it("un contacto con touches fuera de {1,2} se saltea en vez de inventar un followup_3", async () => {
		const draftAndQueue = vi.fn(async (_input: DraftAndQueueInput) => ({
			ok: true as const,
		}));

		const result = await runFollowups(
			deps({
				draftAndQueue,
				store: {
					...deps().store,
					listDueFollowups: async () => [contacto({ touches: 0 })],
				},
			}),
		);

		expect(result.encoladas).toBe(0);
		expect(draftAndQueue).not.toHaveBeenCalled();
		expect(result.salteadas[0].motivo).toMatch(/touches/i);
		expect(result.salteadas[0].tipo).toBe("refusal");
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

	it("el freno también corta next_step_at y sube la etapa a sin_respuesta", async () => {
		const updateContact = vi.fn(async () => ({}) as never);

		await runFollowups(
			deps({
				store: {
					...deps().store,
					listDueFollowups: async () => [],
					listExhaustedContacts: async () => [
						contacto({
							touches: 3,
							crmId: "c1",
							firstTouchAt: "2026-08-01T00:00:00Z",
							stage: "msg1_enviado",
						}),
					],
					insertEvents: vi.fn(async () => {}),
					updateContact,
				},
				listOpenDeals: async () => [
					{ id: "d1", stage: "decisionmakerboughtin" },
				],
			}),
		);

		expect(updateContact).toHaveBeenCalledWith("t1", "c1", {
			nextStepAt: null,
			stage: "sin_respuesta",
		});
	});

	it("si el contacto ya avanzó más allá de rank 2, el freno no lo retrocede de etapa", async () => {
		const updateContact = vi.fn(async () => ({}) as never);

		await runFollowups(
			deps({
				store: {
					...deps().store,
					listDueFollowups: async () => [],
					listExhaustedContacts: async () => [
						contacto({
							touches: 3,
							crmId: "c1",
							firstTouchAt: "2026-08-01T00:00:00Z",
							stage: "reunion_agendada",
						}),
					],
					insertEvents: vi.fn(async () => {}),
					updateContact,
				},
				listOpenDeals: async () => [
					{ id: "d1", stage: "decisionmakerboughtin" },
				],
			}),
		);

		expect(updateContact).toHaveBeenCalledWith("t1", "c1", {
			nextStepAt: null,
		});
	});

	it("correr dos veces no frena al mismo contacto dos veces (idempotente)", async () => {
		// Simula lo que ahora hace listExhaustedContacts de verdad: una vez que
		// insertEvents registra el oportunidad_frenada, ese contact_key deja de
		// volver. La corrida no tiene forma de saberlo por sí sola — depende de
		// que la store se lo garantice — así que este test prueba justo eso: con
		// una store que se comporta así, runFollowups no vuelve a contarlo.
		const frenados = new Set<string>();
		const insertEvents = vi.fn(
			async (rows: { type: string; contact_key: string | null }[]) => {
				for (const row of rows) {
					if (row.type === "oportunidad_frenada" && row.contact_key) {
						frenados.add(row.contact_key);
					}
				}
			},
		);
		const listExhaustedContacts = vi.fn(async () =>
			frenados.has("em:ana@acme.test")
				? []
				: [
						contacto({
							touches: 3,
							crmId: "c1",
							firstTouchAt: "2026-08-01T00:00:00Z",
						}),
					],
		);
		const listOpenDeals = vi.fn(async () => [
			{ id: "d1", stage: "decisionmakerboughtin" },
		]);

		const runDeps = deps({
			store: {
				...deps().store,
				listDueFollowups: async () => [],
				listExhaustedContacts,
				insertEvents,
			},
			listOpenDeals,
		});

		const first = await runFollowups(runDeps);
		const second = await runFollowups(runDeps);

		expect(first.frenadas).toBe(1);
		expect(second.frenadas).toBe(0);
		expect(listExhaustedContacts).toHaveBeenCalledTimes(2);
	});

	it("un fallo al resolver el CRM del contacto agotado queda en frenoFallido, no se disfraza de 'sin deal'", async () => {
		const listOpenDeals = vi.fn(async () => {
			throw new Error("HubSpot 500");
		});

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
				listOpenDeals,
			}),
		);

		expect(result.frenadas).toBe(0);
		expect(result.frenoFallido).toEqual([
			{ contactKey: "em:ana@acme.test", motivo: "HubSpot 500" },
		]);
	});
});
