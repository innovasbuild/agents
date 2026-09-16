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
		getContactEmail: vi.fn().mockResolvedValue(null),
		...overrides,
	};
}

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

	it("un 403 al listar mensajes se reporta como status/cantidad, no como excepción", async () => {
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
		expect(messagesStep?.detail).toContain("403");
		expect(messagesStep?.detail).toContain("0");
	});

	it("Message-ID encontrado y coincidente: s2.rfc822msgid reporta coincide true", async () => {
		const tokenForSubject = vi
			.fn()
			.mockResolvedValue({ token: TOKEN, expiresAt: EXPIRES_AT });
		const queueItem = { id: "qi-uuid-1", contactId: "contact-1" };
		const expectedMessageId = "<qi-qi-uuid-1@innov.as>";
		const fetch = vi.fn().mockImplementation(async (url: string) => {
			if (url.includes("rfc822msgid")) {
				return fakeResponse(200, { messages: [{ id: "gmail-msg-1" }] });
			}
			if (url.includes("/messages/gmail-msg-1")) {
				return fakeResponse(200, {
					payload: {
						headers: [{ name: "Message-ID", value: expectedMessageId }],
					},
				});
			}
			return fakeResponse(200, { messages: [] });
		});
		const findQueueItem = vi.fn().mockResolvedValue(queueItem);
		const deps = baseDeps({ tokenForSubject, fetch, findQueueItem });

		const steps = await runS2Probes(baseInput(), deps);

		const step = steps.find((s) => s.step === "s2.rfc822msgid");
		expect(step?.ok).toBe(true);
		expect(step?.detail).toContain(expectedMessageId);
		expect(step?.detail).toContain("coincide true");
	});

	it("Message-ID no encontrado: s2.rfc822msgid reporta resultados 0 sin tirar", async () => {
		const tokenForSubject = vi
			.fn()
			.mockResolvedValue({ token: TOKEN, expiresAt: EXPIRES_AT });
		const queueItem = { id: "qi-uuid-2", contactId: "contact-2" };
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
	});

	it("s2.fallback enmascara el email del contacto y nunca expone el token", async () => {
		const tokenForSubject = vi
			.fn()
			.mockResolvedValue({ token: TOKEN, expiresAt: EXPIRES_AT });
		const queueItem = { id: "qi-uuid-3", contactId: "contact-3" };
		const fetch = vi
			.fn()
			.mockResolvedValue(fakeResponse(200, { messages: [{ id: "m1" }] }));
		const findQueueItem = vi.fn().mockResolvedValue(queueItem);
		const getContactEmail = vi.fn().mockResolvedValue("laura@acme.test");
		const deps = baseDeps({
			tokenForSubject,
			fetch,
			findQueueItem,
			getContactEmail,
		});

		const steps = await runS2Probes(baseInput(), deps);

		const step = steps.find((s) => s.step === "s2.fallback");
		expect(step?.ok).toBe(true);
		expect(step?.detail).toContain("l***@acme.test");
		expect(step?.detail).not.toContain("laura@acme.test");
	});

	it("ningún detail de ningún paso contiene el token falso, en ningún escenario", async () => {
		const tokenForSubject = vi
			.fn()
			.mockResolvedValue({ token: TOKEN, expiresAt: EXPIRES_AT });
		const fetch = vi
			.fn()
			.mockResolvedValue(fakeResponse(200, { messages: [{ id: "m1" }] }));
		const findQueueItem = vi
			.fn()
			.mockResolvedValue({ id: "qi-uuid-4", contactId: "contact-4" });
		const getContactEmail = vi.fn().mockResolvedValue("dana@acme.test");
		const deps = baseDeps({
			tokenForSubject,
			fetch,
			findQueueItem,
			getContactEmail,
		});

		const steps = await runS2Probes(baseInput(), deps);

		for (const step of steps) {
			expect(step.detail).not.toContain(TOKEN);
			expect(step.detail.toLowerCase()).not.toContain("bearer");
		}
	});
});
