import { describe, expect, it, vi } from "vitest";
import type { GmailMessage } from "@/lib/gmail/read";
import {
	needsHandoff,
	runMorningSweep,
	runSweep,
	type SweepContact,
	type SweepQueueItem,
	scheduleKeyFor,
	takeScheduleLock,
	UNIQUE_VIOLATION,
} from "@/lib/outreach/services/sweep";

const deps = (over: Record<string, unknown> = {}) => ({
	store: {
		listActiveTenants: async () => [{ id: "t1", slug: "innovas" }],
		listExecutorsWithGmailRead: async () => [
			{ tenantId: "t1", userId: "u1", slug: "mati", email: "mati@innov.as" },
		],
		listContactsWithThread: async () => [],
		listKnownInboundIds: async () => [],
		listQueue: async () => [],
		insertEvents: vi.fn(async () => {}),
		updateContact: vi.fn(async () => ({}) as never),
		transitionQueueItem: vi.fn(async () => null),
	},
	getToken: async () => "tok",
	fetchThread: async () => [],
	findByRfc822Id: async () => null,
	now: () => new Date("2026-09-19T10:00:00Z"),
	...over,
});

describe("runSweep", () => {
	it("un ejecutor cuyo token murió no frena a los demás", async () => {
		const getToken = vi
			.fn()
			.mockRejectedValueOnce(new Error("grant vencido"))
			.mockResolvedValueOnce("tok");

		const result = await runSweep(
			deps({
				getToken,
				store: {
					...deps().store,
					listExecutorsWithGmailRead: async () => [
						{
							tenantId: "t1",
							userId: "u1",
							slug: "mati",
							email: "mati@innov.as",
						},
						{
							tenantId: "t1",
							userId: "u2",
							slug: "marcos",
							email: "marcos@innov.as",
						},
					],
				},
			}),
		);

		expect(result.tenants[0].ejecutoresFallidos).toEqual(["mati"]);
		expect(getToken).toHaveBeenCalledTimes(2);
	});

	it("un tenant que explota no frena a los otros", async () => {
		const result = await runSweep(
			deps({
				store: {
					...deps().store,
					listActiveTenants: async () => [
						{ id: "t1", slug: "uno" },
						{ id: "t2", slug: "dos" },
					],
					listExecutorsWithGmailRead: async (tenantId: string) => {
						if (tenantId === "t1") throw new Error("base caída");
						return [
							{
								tenantId: "t2",
								userId: "u1",
								slug: "mati",
								email: "m@innov.as",
							},
						];
					},
				},
			}),
		);

		expect(result.tenants.map((t) => t.slug)).toContain("dos");
	});

	it("el sweep nunca manda un mail", async () => {
		// No hay ninguna dep de envío: si alguien la agrega, este test la caza.
		expect(Object.keys(deps())).not.toContain("sendMail");
	});

	it("registra la respuesta nueva que encuentra en un hilo", async () => {
		const insertEvents = vi.fn(async () => {});
		const result = await runSweep(
			deps({
				store: {
					...deps().store,
					insertEvents,
					listContactsWithThread: async () => [
						{
							id: "c1",
							tenantId: "t1",
							contactKey: "em:ana@acme.test",
							gmailThreadId: "t1",
							stage: "msg1_enviado",
							touches: 1,
						},
					],
				},
				fetchThread: async () => [
					{
						id: "m1",
						threadId: "t1",
						rfc822MessageId: "<a@b.test>",
						from: "ana@acme.test",
						date: "Mon, 14 Sep 2026 10:00:00 -0300",
						snippet: "dale",
						body: "Dale, contame",
						isFromUs: false,
						isBounce: false,
						isAutoReply: false,
					},
				],
			}),
		);

		expect(result.tenants[0].respuestas).toBe(1);
		expect(insertEvents).toHaveBeenCalled();
	});
});

// ---------------------------------------------------------------------------
// Lo que el brief pide como piso, arriba. De acá para abajo, lo que un error
// silencioso a la madrugada costaría caro: el lock, la auto-respuesta que no
// es respuesta, el rebote y el veredicto de la reconciliación.
// ---------------------------------------------------------------------------

const mensaje = (over: Partial<GmailMessage> = {}): GmailMessage => ({
	id: "m1",
	threadId: "hilo-1",
	rfc822MessageId: "<a@b.test>",
	from: "ana@acme.test",
	date: "Mon, 14 Sep 2026 10:00:00 -0300",
	snippet: "dale",
	body: "Dale, contame",
	isFromUs: false,
	isBounce: false,
	isAutoReply: false,
	...over,
});

const contacto = (over: Partial<SweepContact> = {}): SweepContact => ({
	id: "c1",
	tenantId: "t1",
	contactKey: "em:ana@acme.test",
	gmailThreadId: "hilo-1",
	stage: "msg1_enviado",
	touches: 1,
	...over,
});

const pieza = (over: Partial<SweepQueueItem> = {}): SweepQueueItem => ({
	id: "q1",
	contactKey: "em:ana@acme.test",
	toEmail: "ana@acme.test",
	approvedAt: "2026-09-19T08:00:00Z",
	...over,
});

describe("el lock de la corrida", () => {
	it("arma la clave con la fecha del día", () => {
		expect(
			scheduleKeyFor("morning-sweep", new Date("2026-09-19T10:00:00Z")),
		).toBe("morning-sweep:2026-09-19");
	});

	it("un 23505 significa que ya corrió hoy: no es un error", async () => {
		const insertRun = vi.fn(async () => ({
			error: { code: UNIQUE_VIOLATION, message: "duplicate key" },
		}));

		await expect(
			takeScheduleLock(
				{ insertRun },
				{
					scheduleKey: "morning-sweep:2026-09-19",
					tenantId: "t1",
					agent: "outreach",
				},
			),
		).resolves.toBe(false);
	});

	it("el insert que entra toma el lock", async () => {
		const insertRun = vi.fn(async () => ({ error: null }));

		await expect(
			takeScheduleLock(
				{ insertRun },
				{
					scheduleKey: "morning-sweep:2026-09-19",
					tenantId: "t1",
					agent: "outreach",
				},
			),
		).resolves.toBe(true);
		expect(insertRun).toHaveBeenCalledWith(
			expect.objectContaining({
				schedule_key: "morning-sweep:2026-09-19",
				tenant_id: "t1",
				trigger: "schedule",
			}),
		);
	});

	it("cualquier otro error de la base no se traga: revienta", async () => {
		const insertRun = vi.fn(async () => ({
			error: { code: "08006", message: "connection failure" },
		}));

		await expect(
			takeScheduleLock(
				{ insertRun },
				{
					scheduleKey: "morning-sweep:2026-09-19",
					tenantId: "t1",
					agent: "outreach",
				},
			),
		).rejects.toThrow("connection failure");
	});

	it("si ya corrió hoy no barre nada, ni parcialmente", async () => {
		const listActiveTenants = vi.fn(async () => [
			{ id: "t1", slug: "innovas" },
		]);
		const result = await runMorningSweep({
			...deps({ store: { ...deps().store, listActiveTenants } }),
			takeLock: async () => false,
		});

		expect(result).toBeNull();
		expect(listActiveTenants).not.toHaveBeenCalled();
	});

	it("con el lock tomado barre normalmente", async () => {
		const result = await runMorningSweep({
			...deps(),
			takeLock: async () => true,
		});
		expect(result?.tenants).toHaveLength(1);
	});
});

describe("qué cuenta como respuesta", () => {
	it("una auto-respuesta queda registrada pero no cuenta ni mueve el contacto", async () => {
		const insertEvents = vi.fn(async () => {});
		const updateContact = vi.fn(async () => ({}) as never);

		const result = await runSweep(
			deps({
				store: {
					...deps().store,
					insertEvents,
					updateContact,
					listContactsWithThread: async () => [contacto()],
				},
				fetchThread: async () => [
					mensaje({
						isAutoReply: true,
						body: "Estoy de vacaciones hasta el 3/10",
					}),
				],
			}),
		);

		expect(result.tenants[0].respuestas).toBe(0);
		expect(insertEvents).toHaveBeenCalled();
		// Ni replied_at ni etapa: la cadencia de follow-ups de esa persona sigue viva.
		expect(updateContact).not.toHaveBeenCalled();
	});

	it("un rebote cuenta como rebote y corta el próximo paso", async () => {
		const updateContact = vi.fn(async () => ({}) as never);

		const result = await runSweep(
			deps({
				store: {
					...deps().store,
					updateContact,
					listContactsWithThread: async () => [contacto()],
				},
				fetchThread: async () => [
					mensaje({
						from: "mailer-daemon@googlemail.com",
						isBounce: true,
						body: "Address not found",
					}),
				],
			}),
		);

		expect(result.tenants[0].rebotes).toBe(1);
		expect(result.tenants[0].respuestas).toBe(0);
		expect(updateContact).toHaveBeenCalledWith("t1", "c1", {
			nextStepAt: null,
		});
	});

	it("una respuesta real deja al contacto en respuesta_neutra, que es lo que lee read_replies", async () => {
		const updateContact = vi.fn(async () => ({}) as never);

		await runSweep(
			deps({
				store: {
					...deps().store,
					updateContact,
					listContactsWithThread: async () => [contacto()],
				},
				fetchThread: async () => [mensaje()],
			}),
		);

		expect(updateContact).toHaveBeenCalledWith("t1", "c1", {
			repliedAt: "2026-09-19T10:00:00.000Z",
			nextStepAt: null,
			stage: "respuesta_neutra",
		});
	});

	it("un mensaje ya conocido no se registra dos veces", async () => {
		const insertEvents = vi.fn(async () => {});

		const result = await runSweep(
			deps({
				store: {
					...deps().store,
					insertEvents,
					listContactsWithThread: async () => [contacto()],
					listKnownInboundIds: async () => ["m1"],
				},
				fetchThread: async () => [mensaje()],
			}),
		);

		expect(result.tenants[0].respuestas).toBe(0);
		expect(insertEvents).not.toHaveBeenCalled();
	});

	it("lee los contactos del tenant y del ejecutor que está barriendo", async () => {
		const listContactsWithThread = vi.fn(async () => []);

		await runSweep(
			deps({ store: { ...deps().store, listContactsWithThread } }),
		);

		expect(listContactsWithThread).toHaveBeenCalledWith("t1", "u1");
	});
});

describe("reconciliación de piezas aprobadas", () => {
	it("una pieza que no aparece en enviados queda trabada, no se reencola", async () => {
		const transitionQueueItem = vi.fn(async () => null);

		const result = await runSweep(
			deps({
				store: {
					...deps().store,
					transitionQueueItem,
					listQueue: async () => [pieza()],
				},
				findByRfc822Id: async () => null,
			}),
		);

		expect(result.tenants[0].trabadas).toBe(1);
		expect(result.tenants[0].reconciliadas).toBe(0);
		expect(transitionQueueItem).not.toHaveBeenCalled();
	});

	it("una pieza que sí aparece en enviados pasa a sent con los ids de Gmail", async () => {
		const transitionQueueItem = vi.fn(async () => ({ id: "q1" }));

		const result = await runSweep(
			deps({
				store: {
					...deps().store,
					transitionQueueItem,
					listQueue: async () => [pieza()],
				},
				findByRfc822Id: async () => ({ id: "g1", threadId: "h1" }),
			}),
		);

		expect(result.tenants[0].reconciliadas).toBe(1);
		expect(transitionQueueItem).toHaveBeenCalledWith("t1", "q1", "approved", {
			status: "sent",
			gmailMessageId: "g1",
			gmailThreadId: "h1",
			sentAt: "2026-09-19T10:00:00.000Z",
		});
	});

	it("una pieza recién aprobada no se toca: el envío puede estar en vuelo", async () => {
		const findByRfc822Id = vi.fn(async () => null);

		const result = await runSweep(
			deps({
				store: {
					...deps().store,
					listQueue: async () => [
						pieza({ approvedAt: "2026-09-19T09:55:00Z" }),
					],
				},
				findByRfc822Id,
			}),
		);

		expect(findByRfc822Id).not.toHaveBeenCalled();
		expect(result.tenants[0].trabadas).toBe(0);
	});

	it("solo mira las piezas approved del ejecutor", async () => {
		const listQueue = vi.fn(async () => []);

		await runSweep(deps({ store: { ...deps().store, listQueue } }));

		expect(listQueue).toHaveBeenCalledWith("t1", "u1", ["approved"]);
	});
});

describe("needsHandoff", () => {
	it("sin respuestas nuevas no hay nada que interpretar", () => {
		expect(
			needsHandoff({
				tenantId: "t1",
				slug: "innovas",
				respuestas: 0,
				rebotes: 3,
				reconciliadas: 1,
				trabadas: 2,
				ejecutoresFallidos: ["mati"],
			}),
		).toBe(false);
	});

	it("una respuesta nueva abre el hilo de la mañana", () => {
		expect(
			needsHandoff({
				tenantId: "t1",
				slug: "innovas",
				respuestas: 1,
				rebotes: 0,
				reconciliadas: 0,
				trabadas: 0,
				ejecutoresFallidos: [],
			}),
		).toBe(true);
	});
});
