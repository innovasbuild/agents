// TEMPORAL (spec 03 §13, spike S2): se borra después de correr el spike.
import { describe, expect, it, vi } from "vitest";
import { runS2Probes, type S2Deps } from "@/lib/spikes/s2";

const TOKEN = "tok-secreto-readonly-123";
const SEND_TOKEN = "tok-secreto-send-456";
const EXPIRES_AT = 1_893_456_000_000; // 2030-01-01T00:00:00.000Z

class UserAuthorizationRequiredError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "UserAuthorizationRequiredError";
	}
}

function fakeResponse(status: number, body: unknown = {}): Response {
	return {
		ok: status >= 200 && status < 300,
		status,
		json: async () => body,
		text: async () => JSON.stringify(body),
	} as Response;
}

function baseInput() {
	return {
		tenantId: "tenant-1",
		userId: "user-1",
		issuer: "https://issuer.test",
		callerEmail: "matias@innov.as",
	};
}

function baseDeps(overrides: Partial<S2Deps> = {}): S2Deps {
	return {
		tokenForSubject: vi
			.fn()
			.mockResolvedValue({ token: SEND_TOKEN, expiresAt: EXPIRES_AT }),
		fetch: vi.fn().mockResolvedValue(fakeResponse(200, {})),
		findQueueItem: vi.fn().mockResolvedValue(null),
		...overrides,
	};
}

const OUR_MESSAGE_ID = "<qi-qi-uuid-1@innov.as>";

describe("runS2Probes", () => {
	it("readonly concedido: s2.token.readonly da ok y ningún token aparece en la salida", async () => {
		const tokenForSubject = vi
			.fn()
			.mockImplementation(
				async (
					_connector: string,
					_who: unknown,
					scopes?: string[],
				): Promise<{ token: string; expiresAt: number }> => {
					if (
						scopes?.includes("https://www.googleapis.com/auth/gmail.readonly")
					) {
						return { token: TOKEN, expiresAt: EXPIRES_AT };
					}
					return { token: SEND_TOKEN, expiresAt: EXPIRES_AT };
				},
			);
		const fetch = vi
			.fn()
			.mockResolvedValue(fakeResponse(200, { messages: [] }));
		const deps = baseDeps({ tokenForSubject, fetch });

		const steps = await runS2Probes(baseInput(), deps);

		const readonlyStep = steps.find(
			(step) => step.step === "s2.token.readonly",
		);
		expect(readonlyStep?.ok).toBe(true);
		expect(JSON.stringify(steps)).not.toContain(TOKEN);
		expect(JSON.stringify(steps)).not.toContain(SEND_TOKEN);
	});

	it("readonly denegado (UserAuthorizationRequiredError): el detail dice que hay que reautorizar, y s2.token.send igual corre ok", async () => {
		const tokenForSubject = vi
			.fn()
			.mockImplementation(
				async (
					_connector: string,
					_who: unknown,
					scopes?: string[],
				): Promise<{ token: string; expiresAt: number }> => {
					if (
						scopes?.includes("https://www.googleapis.com/auth/gmail.readonly")
					) {
						throw new UserAuthorizationRequiredError(
							"no hay grant con ese scope",
						);
					}
					return { token: SEND_TOKEN, expiresAt: EXPIRES_AT };
				},
			);
		const deps = baseDeps({ tokenForSubject });

		const steps = await runS2Probes(baseInput(), deps);

		const sendStep = steps.find((step) => step.step === "s2.token.send");
		expect(sendStep?.ok).toBe(true);

		const readonlyStep = steps.find(
			(step) => step.step === "s2.token.readonly",
		);
		expect(readonlyStep?.ok).toBe(false);
		expect(readonlyStep?.detail).toContain("UserAuthorizationRequiredError");
		expect(readonlyStep?.detail.toLowerCase()).toContain("autorizar");

		// Sin token readonly, los pasos que dependen de él quedan ok:false pero
		// no frenan al resto (siguen corriendo y reportando).
		const messagesStep = steps.find((step) => step.step === "s2.messages.list");
		expect(messagesStep?.ok).toBe(false);
		expect(JSON.stringify(steps)).not.toContain(SEND_TOKEN);
	});

	it("un 403 al listar mensajes se reporta como status/cantidad, no como excepción (aserción no vacua)", async () => {
		const tokenForSubject = vi
			.fn()
			.mockResolvedValue({ token: TOKEN, expiresAt: EXPIRES_AT });
		const fetch = vi
			.fn()
			.mockResolvedValue(fakeResponse(403, { error: "insufficient scope" }));
		const deps = baseDeps({ tokenForSubject, fetch });

		const steps = await runS2Probes(baseInput(), deps);

		const messagesStep = steps.find((step) => step.step === "s2.messages.list");
		expect(messagesStep?.ok).toBe(true);
		// "mensajes 0" en vez de sólo "0": "403" ya contiene un "0" y hacía la
		// aserción vacua sin importar la cantidad real devuelta.
		expect(messagesStep?.detail).toBe("status 403, mensajes 0");
	});

	it("s2.header_match: Gmail devuelve el mismo Message-ID (coincide true), determinístico vía gmail_message_id", async () => {
		const tokenForSubject = vi
			.fn()
			.mockResolvedValue({ token: TOKEN, expiresAt: EXPIRES_AT });
		const queueItem = {
			id: "qi-uuid-1",
			toEmail: "laura@acme.test",
			gmailMessageId: "gmail-msg-1",
		};
		const fetch = vi.fn().mockImplementation(async (url: string) => {
			if (url.includes("/messages/gmail-msg-1")) {
				return fakeResponse(200, {
					payload: {
						headers: [{ name: "Message-ID", value: OUR_MESSAGE_ID }],
					},
				});
			}
			return fakeResponse(200, { messages: [] });
		});
		const findQueueItem = vi.fn().mockResolvedValue(queueItem);
		const deps = baseDeps({ tokenForSubject, fetch, findQueueItem });

		const steps = await runS2Probes(baseInput(), deps);

		const step = steps.find((s) => s.step === "s2.header_match");
		expect(step?.ok).toBe(true);
		expect(step?.detail).toContain("coincide true");
		expect(step?.detail).toContain(OUR_MESSAGE_ID);

		// La búsqueda por rfc822msgid: es un paso aparte que no infiere nada.
		const searchStep = steps.find((s) => s.step === "s2.rfc822msgid");
		expect(searchStep?.detail).not.toContain("coincide");
	});

	it("s2.header_match: Gmail devuelve un Message-ID distinto (coincide false) — el hallazgo positivo que busca el spike", async () => {
		const tokenForSubject = vi
			.fn()
			.mockResolvedValue({ token: TOKEN, expiresAt: EXPIRES_AT });
		const queueItem = {
			id: "qi-uuid-1",
			toEmail: "laura@acme.test",
			gmailMessageId: "gmail-msg-1",
		};
		const rewrittenId = "<CAOenc123abc@mail.gmail.com>";
		const fetch = vi.fn().mockImplementation(async (url: string) => {
			if (url.includes("/messages/gmail-msg-1")) {
				return fakeResponse(200, {
					payload: {
						headers: [{ name: "Message-ID", value: rewrittenId }],
					},
				});
			}
			return fakeResponse(200, { messages: [] });
		});
		const findQueueItem = vi.fn().mockResolvedValue(queueItem);
		const deps = baseDeps({ tokenForSubject, fetch, findQueueItem });

		const steps = await runS2Probes(baseInput(), deps);

		const step = steps.find((s) => s.step === "s2.header_match");
		// "no coincide" es un resultado válido y determinado, no un fallo del
		// paso: ok tiene que seguir siendo true.
		expect(step?.ok).toBe(true);
		expect(step?.detail).toContain("coincide false");
		expect(step?.detail).toContain(rewrittenId);
		expect(step?.detail).toContain(OUR_MESSAGE_ID);
	});

	it("s2.header_match: si la llamada de metadata falla, queda ok:false y no se confunde con 'no coincide'", async () => {
		const tokenForSubject = vi
			.fn()
			.mockResolvedValue({ token: TOKEN, expiresAt: EXPIRES_AT });
		const queueItem = {
			id: "qi-uuid-1",
			toEmail: "laura@acme.test",
			gmailMessageId: "gmail-msg-1",
		};
		const fetch = vi.fn().mockImplementation(async (url: string) => {
			if (url.includes("/messages/gmail-msg-1")) {
				return fakeResponse(500, { error: "backend error" });
			}
			return fakeResponse(200, { messages: [] });
		});
		const findQueueItem = vi.fn().mockResolvedValue(queueItem);
		const deps = baseDeps({ tokenForSubject, fetch, findQueueItem });

		const steps = await runS2Probes(baseInput(), deps);

		const step = steps.find((s) => s.step === "s2.header_match");
		expect(step?.ok).toBe(false);
		expect(step?.detail).not.toContain("coincide");
		expect(step?.detail).toContain("500");
	});

	it("Message-ID no encontrado por búsqueda: s2.rfc822msgid reporta resultados 0 sin tirar ni inferir nada", async () => {
		const tokenForSubject = vi
			.fn()
			.mockResolvedValue({ token: TOKEN, expiresAt: EXPIRES_AT });
		const queueItem = {
			id: "qi-uuid-2",
			toEmail: "laura@acme.test",
			gmailMessageId: null,
		};
		const fetch = vi
			.fn()
			.mockResolvedValue(fakeResponse(200, { messages: [] }));
		const findQueueItem = vi.fn().mockResolvedValue(queueItem);
		const deps = baseDeps({ tokenForSubject, fetch, findQueueItem });

		const steps = await runS2Probes(baseInput(), deps);

		const step = steps.find((s) => s.step === "s2.rfc822msgid");
		expect(step?.ok).toBe(true);
		expect(step?.detail).toContain("resultados 0");
		expect(step?.detail).not.toContain("coincide");

		// Sin gmail_message_id guardado, el paso determinístico no puede
		// correr: queda ok:false con un motivo explícito, no un "coincide".
		const headerStep = steps.find((s) => s.step === "s2.header_match");
		expect(headerStep?.ok).toBe(false);
		expect(headerStep?.detail).not.toContain("coincide");
	});

	it("s2.fallback usa el to_email de la pieza (no un email de contacto editado después) y lo enmascara", async () => {
		const tokenForSubject = vi
			.fn()
			.mockResolvedValue({ token: TOKEN, expiresAt: EXPIRES_AT });
		const queueItem = {
			id: "qi-uuid-3",
			toEmail: "laura@acme.test",
			gmailMessageId: "gmail-msg-1",
		};
		const fetch = vi
			.fn()
			.mockResolvedValue(fakeResponse(200, { messages: [{ id: "m1" }] }));
		const findQueueItem = vi.fn().mockResolvedValue(queueItem);
		const deps = baseDeps({ tokenForSubject, fetch, findQueueItem });

		const steps = await runS2Probes(baseInput(), deps);

		const step = steps.find((s) => s.step === "s2.fallback");
		expect(step?.ok).toBe(true);
		expect(step?.detail).toContain("l***@acme.test");
		expect(step?.detail).not.toContain("laura@acme.test");
	});

	it("queue_item de otro ejecutor: findQueueItem tira un detail explícito, no un 0 mudo", async () => {
		const tokenForSubject = vi
			.fn()
			.mockResolvedValue({ token: TOKEN, expiresAt: EXPIRES_AT });
		const fetch = vi
			.fn()
			.mockResolvedValue(fakeResponse(200, { messages: [] }));
		const findQueueItem = vi
			.fn()
			.mockRejectedValue(
				new Error(
					"esa pieza la mandó otro ejecutor: corré el spike con la sesión de esa persona",
				),
			);
		const deps = baseDeps({ tokenForSubject, fetch, findQueueItem });

		const steps = await runS2Probes(
			{ ...baseInput(), queueItemId: "otro-uuid" },
			deps,
		);

		const step = steps.find((s) => s.step === "s2.rfc822msgid");
		expect(step?.ok).toBe(false);
		expect(step?.detail).toContain("otro ejecutor");
	});

	it("ningún detail, ni ninguna URL pasada a fetch, contiene el token; tokeninfo lo lleva en el body", async () => {
		const tokenForSubject = vi
			.fn()
			.mockResolvedValue({ token: TOKEN, expiresAt: EXPIRES_AT });
		const fetch = vi
			.fn()
			.mockResolvedValue(fakeResponse(200, { messages: [{ id: "m1" }] }));
		const findQueueItem = vi.fn().mockResolvedValue({
			id: "qi-uuid-4",
			toEmail: "dana@acme.test",
			gmailMessageId: "gmail-msg-1",
		});
		const deps = baseDeps({ tokenForSubject, fetch, findQueueItem });

		const steps = await runS2Probes(baseInput(), deps);

		for (const step of steps) {
			expect(step.detail).not.toContain(TOKEN);
			expect(step.detail.toLowerCase()).not.toContain("bearer");
		}

		const calls = fetch.mock.calls as [string, RequestInit | undefined][];
		for (const [calledUrl] of calls) {
			expect(calledUrl).not.toContain(TOKEN);
		}
		const tokeninfoCall = calls.find(([calledUrl]) =>
			calledUrl.includes("oauth2.googleapis.com/tokeninfo"),
		);
		expect(tokeninfoCall).toBeDefined();
		expect(tokeninfoCall?.[1]?.body).toContain(TOKEN);
		expect(
			(tokeninfoCall?.[1]?.headers as Record<string, string>)?.Authorization,
		).toBeUndefined();
	});
});
