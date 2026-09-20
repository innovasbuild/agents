import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { GmailMessage } from "@/lib/gmail/read";
import {
	needsHandoff,
	runMorningSweep,
	runSweep,
	type SweepContact,
	type SweepQueueItem,
	type SweepTenantResult,
	scheduleKeyFor,
	takeScheduleLock,
	UNIQUE_VIOLATION,
} from "@/lib/outreach/services/sweep";

const SWEEP_SOURCE = readFileSync(
	join(__dirname, "..", "..", "..", "lib", "outreach", "services", "sweep.ts"),
	"utf8",
);

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

	it("el sweep nunca manda un mail", () => {
		// La garantía no es que este fixture no tenga una dep de envío (eso sería
		// el test verificándose a sí mismo): es que el módulo no tiene forma de
		// mandar nada. Ni dep declarada, ni import del camino de envío.
		const sweepDeps =
			SWEEP_SOURCE.match(/export interface SweepDeps \{([\s\S]*?)\n\}/)?.[1] ??
			"";

		expect(sweepDeps).not.toBe("");
		expect(sweepDeps).not.toMatch(/send/i);
		expect(SWEEP_SOURCE).not.toMatch(/from\s+["'][^"']*gmail\/send["']/);
		expect(SWEEP_SOURCE).not.toMatch(/from\s+["'][^"']*services\/send["']/);
		expect(SWEEP_SOURCE).not.toMatch(/\bsendMail\b/);
		expect(SWEEP_SOURCE).not.toMatch(/\bsendQueuedEmail\b/);
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
		const listExecutorsWithGmailRead = vi.fn(async () => []);
		const result = await runMorningSweep({
			...deps({ store: { ...deps().store, listExecutorsWithGmailRead } }),
			takeLock: async () => false,
		});

		expect(result).toBeNull();
		expect(listExecutorsWithGmailRead).not.toHaveBeenCalled();
	});

	it("los tenants se listan ANTES del lock: un hipo de red no quema el día", async () => {
		const takeLock = vi.fn(async () => true);

		await expect(
			runMorningSweep({
				...deps({
					store: {
						...deps().store,
						listActiveTenants: async () => {
							throw new Error("base caída");
						},
					},
				}),
				takeLock,
			}),
		).rejects.toThrow("base caída");
		// El lock no se tomó: el próximo disparo del día puede correr.
		expect(takeLock).not.toHaveBeenCalled();
	});

	it("el lock recibe los tenants ya listados, no los vuelve a pedir", async () => {
		const listActiveTenants = vi.fn(async () => [
			{ id: "t1", slug: "innovas" },
		]);
		const takeLock = vi.fn(async () => true);

		await runMorningSweep({
			...deps({ store: { ...deps().store, listActiveTenants } }),
			takeLock,
		});

		expect(listActiveTenants).toHaveBeenCalledTimes(1);
		expect(takeLock).toHaveBeenCalledWith([{ id: "t1", slug: "innovas" }]);
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

	it("una respuesta de alguien ya avanzado se registra pero no infla el número del handoff", async () => {
		const insertEvents = vi.fn(async () => {});

		const result = await runSweep(
			deps({
				store: {
					...deps().store,
					insertEvents,
					// Ya está en en_conversacion: canAdvance no lo baja a
					// respuesta_neutra, así que read_replies nunca lo va a ver.
					listContactsWithThread: async () => [
						contacto({ stage: "en_conversacion" }),
					],
				},
				fetchThread: async () => [mensaje()],
			}),
		);

		expect(insertEvents).toHaveBeenCalled();
		expect(result.tenants[0].respuestas).toBe(0);
		expect(result.tenants[0].respuestasAvanzadas).toBe(1);
		expect(needsHandoff(result.tenants[0])).toBe(false);
	});

	it("una respuesta nueva de quien ya estaba en respuesta_neutra sigue contando", async () => {
		const result = await runSweep(
			deps({
				store: {
					...deps().store,
					listContactsWithThread: async () => [
						contacto({ stage: "respuesta_neutra" }),
					],
				},
				fetchThread: async () => [mensaje()],
			}),
		);

		// canAdvance no mueve nada (ya está ahí), pero el contacto SÍ sale en
		// read_replies: cuenta.
		expect(result.tenants[0].respuestas).toBe(1);
		expect(result.tenants[0].respuestasAvanzadas).toBe(0);
	});

	it("lee los contactos del tenant y del ejecutor que está barriendo", async () => {
		const listContactsWithThread = vi.fn(async () => []);

		await runSweep(
			deps({ store: { ...deps().store, listContactsWithThread } }),
		);

		expect(listContactsWithThread).toHaveBeenCalledWith("t1", "u1");
	});
});

describe("aislamiento por contacto", () => {
	it("un hilo que explota no frena a los contactos que siguen", async () => {
		const insertEvents = vi.fn(async () => {});
		const fetchThread = vi.fn(async (_token: string, threadId: string) => {
			// Gmail tira ante cualquier respuesta no-OK: un hilo borrado, un 429.
			if (threadId === "hilo-2") throw new Error("Gmail 404: hilo borrado");
			return [mensaje({ threadId })];
		});

		const result = await runSweep(
			deps({
				store: {
					...deps().store,
					insertEvents,
					listContactsWithThread: async () => [
						contacto({
							id: "c1",
							contactKey: "em:uno@a.test",
							gmailThreadId: "hilo-1",
						}),
						contacto({
							id: "c2",
							contactKey: "em:dos@a.test",
							gmailThreadId: "hilo-2",
						}),
						contacto({
							id: "c3",
							contactKey: "em:tres@a.test",
							gmailThreadId: "hilo-3",
						}),
					],
				},
				fetchThread,
			}),
		);

		expect(fetchThread).toHaveBeenCalledTimes(3);
		expect(result.tenants[0].respuestas).toBe(2);
		expect(result.tenants[0].contactosFallidos).toBe(1);
		// El token está vivo: el ejecutor no falló.
		expect(result.tenants[0].ejecutoresFallidos).toEqual([]);
	});

	it("un hilo que explota tampoco se lleva puesta la reconciliación del ejecutor", async () => {
		const listQueue = vi.fn(async () => []);

		await runSweep(
			deps({
				store: {
					...deps().store,
					listQueue,
					listContactsWithThread: async () => [contacto()],
				},
				fetchThread: async () => {
					throw new Error("Gmail 503");
				},
			}),
		);

		expect(listQueue).toHaveBeenCalledWith("t1", "u1", ["approved"]);
	});

	it("un ejecutor sin email en auth.users queda a la vista, no se saltea en silencio", async () => {
		const listContactsWithThread = vi.fn(async () => []);
		const fetchThread = vi.fn(async () => []);

		const result = await runSweep(
			deps({
				store: {
					...deps().store,
					listContactsWithThread,
					listExecutorsWithGmailRead: async () => [
						{ tenantId: "t1", userId: "u1", slug: "mati", email: null },
					],
				},
				fetchThread,
			}),
		);

		// Sin el email no se puede saber qué mensajes del hilo son nuestros:
		// barrerlo igual registraría nuestro propio mail como respuesta del otro.
		// Por eso se corta antes de leer nada, no a mitad de camino.
		expect(result.tenants[0].ejecutoresFallidos).toEqual(["mati"]);
		expect(listContactsWithThread).not.toHaveBeenCalled();
		expect(fetchThread).not.toHaveBeenCalled();
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
	const resultado = (
		over: Partial<SweepTenantResult> = {},
	): SweepTenantResult => ({
		tenantId: "t1",
		slug: "innovas",
		respuestas: 0,
		respuestasAvanzadas: 0,
		rebotes: 0,
		reconciliadas: 0,
		trabadas: 0,
		contactosFallidos: 0,
		ejecutoresFallidos: [],
		...over,
	});

	it("sin respuestas nuevas no hay nada que interpretar", () => {
		expect(
			needsHandoff(
				resultado({
					rebotes: 3,
					reconciliadas: 1,
					trabadas: 2,
					ejecutoresFallidos: ["mati"],
				}),
			),
		).toBe(false);
	});

	it("una respuesta nueva abre el hilo de la mañana", () => {
		expect(needsHandoff(resultado({ respuestas: 1 }))).toBe(true);
	});

	it("una respuesta que el agente no va a poder ver no abre nada", () => {
		// read_replies filtra por respuesta_neutra: si el contacto ya está más
		// arriba, la tool devuelve vacío y el handoff sería un hilo mintiendo.
		expect(needsHandoff(resultado({ respuestasAvanzadas: 4 }))).toBe(false);
	});
});
