// TEMPORAL (spec 03 §13): se borra después de correr los spikes en producción.
import { describe, expect, it, vi } from "vitest";
import { type ProbeDeps, runEtapa3Probes } from "@/lib/spikes/etapa-3";

const TOKEN = "tok-secreto-123";
const EXPIRES_AT = 1_893_456_000_000; // 2030-01-01T00:00:00.000Z

class UserAuthorizationRequiredError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "UserAuthorizationRequiredError";
	}
}

function fakeResponse(status: number, body: unknown = {}, text = ""): Response {
	return {
		ok: status >= 200 && status < 300,
		status,
		json: async () => body,
		text: async () => text || JSON.stringify(body),
	} as Response;
}

function baseInput() {
	return {
		tenantId: "tenant-1",
		userId: "user-1",
		issuer: "https://issuer.test",
		hubspotWrite: false,
	};
}

describe("runEtapa3Probes", () => {
	it("con tokens OK y fetch 200, todos los pasos s1 dan ok y el token nunca aparece en el resultado", async () => {
		const tokenForSubject = vi.fn().mockResolvedValue({
			token: TOKEN,
			expiresAt: EXPIRES_AT,
		});
		const fetch = vi.fn().mockResolvedValue(fakeResponse(200));
		const generate = vi.fn().mockResolvedValue({
			output: { categoria: "no_interesado" },
			usage: { totalTokens: 10 },
		});
		const deps: ProbeDeps = {
			tokenForSubject,
			fetch,
			generate,
			now: () => 1000,
		};

		const steps = await runEtapa3Probes(baseInput(), deps);

		const s1Steps = steps.filter((step) => step.step.startsWith("s1."));
		expect(s1Steps).toHaveLength(4);
		for (const step of s1Steps) {
			expect(step.ok).toBe(true);
		}
		expect(JSON.stringify(steps)).not.toContain(TOKEN);

		const calls = fetch.mock.calls as [string, RequestInit | undefined][];
		const gmailCall = calls.find(([callUrl]) =>
			callUrl.includes("gmail.googleapis.com"),
		);
		const hubspotCall = calls.find(([callUrl]) =>
			callUrl.includes("api.hubapi.com"),
		);
		expect(gmailCall?.[1]?.signal).toBeInstanceOf(AbortSignal);
		expect(hubspotCall?.[1]?.signal).toBeInstanceOf(AbortSignal);
	});

	it("un tokenForSubject que tira UserAuthorizationRequiredError deja ok:false con el nombre del error, y los pasos siguientes igual corren", async () => {
		const tokenForSubject = vi
			.fn()
			.mockImplementation(
				async (
					connector: string,
					who: { issuer?: string },
				): Promise<{ token: string; expiresAt: number }> => {
					if (connector === "google/google" && who.issuer) {
						throw new UserAuthorizationRequiredError(
							"no hay grant de google para este usuario",
						);
					}
					return { token: TOKEN, expiresAt: EXPIRES_AT };
				},
			);
		const fetch = vi.fn().mockResolvedValue(fakeResponse(200));
		const generate = vi.fn().mockResolvedValue({ output: {}, usage: {} });
		const deps: ProbeDeps = {
			tokenForSubject,
			fetch,
			generate,
			now: () => 1000,
		};

		const steps = await runEtapa3Probes(baseInput(), deps);

		const failed = steps.find((step) => step.step === "s1.google.con_issuer");
		expect(failed?.ok).toBe(false);
		expect(failed?.detail).toContain("UserAuthorizationRequiredError");

		const others = steps.filter((step) => step.step !== "s1.google.con_issuer");
		expect(others.length).toBeGreaterThan(0);
		for (const step of others.filter((step) => step.step.startsWith("s1."))) {
			expect(step.ok).toBe(true);
		}
	});

	it("hubspotWrite: false no hace ningún POST", async () => {
		const tokenForSubject = vi
			.fn()
			.mockResolvedValue({ token: TOKEN, expiresAt: EXPIRES_AT });
		const fetch = vi.fn().mockResolvedValue(fakeResponse(200));
		const generate = vi.fn().mockResolvedValue({ output: {}, usage: {} });
		const deps: ProbeDeps = {
			tokenForSubject,
			fetch,
			generate,
			now: () => 1000,
		};

		await runEtapa3Probes({ ...baseInput(), hubspotWrite: false }, deps);

		const methods = fetch.mock.calls.map(
			(call) => (call[1] as RequestInit | undefined)?.method ?? "GET",
		);
		expect(methods.filter((m) => m === "POST")).toHaveLength(0);
		expect(methods.filter((m) => m === "DELETE")).toHaveLength(0);
	});

	it("hubspotWrite: true hace 4 POST y 1 DELETE con el Bearer correcto, y el token no aparece en el resultado", async () => {
		const tokenForSubject = vi
			.fn()
			.mockResolvedValue({ token: TOKEN, expiresAt: EXPIRES_AT });
		const fetch = vi
			.fn()
			.mockImplementation(async (url: string, init?: RequestInit) => {
				const method = init?.method ?? "GET";
				if (method === "POST" && url.includes("/contacts")) {
					return fakeResponse(201, { id: "contact-1" });
				}
				if (method === "POST" && url.includes("/notes")) {
					return fakeResponse(201, { id: "note-1" });
				}
				if (method === "POST" && url.includes("/tasks")) {
					return fakeResponse(201, { id: "task-1" });
				}
				if (method === "POST" && url.includes("/deals")) {
					return fakeResponse(201, { id: "deal-1" });
				}
				if (method === "DELETE") {
					return fakeResponse(204);
				}
				return fakeResponse(200);
			});
		const generate = vi.fn().mockResolvedValue({ output: {}, usage: {} });
		const deps: ProbeDeps = {
			tokenForSubject,
			fetch,
			generate,
			now: () => 1000,
		};

		const steps = await runEtapa3Probes(
			{ ...baseInput(), hubspotWrite: true },
			deps,
		);

		const calls = fetch.mock.calls as [string, RequestInit | undefined][];
		const posts = calls.filter(([, init]) => init?.method === "POST");
		const deletes = calls.filter(([, init]) => init?.method === "DELETE");
		expect(posts).toHaveLength(4);
		expect(deletes).toHaveLength(1);
		for (const [, init] of [...posts, ...deletes]) {
			const headers = init?.headers as Record<string, string>;
			expect(headers.Authorization).toBe(`Bearer ${TOKEN}`);
		}
		expect(JSON.stringify(steps)).not.toContain(TOKEN);

		const s6Steps = steps.filter((step) => step.step.startsWith("s6."));
		for (const step of s6Steps) {
			expect(step.ok).toBe(true);
		}

		const contactCall = calls.find(
			([url, init]) => init?.method === "POST" && url.includes("/contacts"),
		);
		const contactBody = JSON.parse((contactCall?.[1]?.body as string) ?? "{}");
		expect(contactBody.properties.email).toMatch(/@example\.com$/);
		expect(contactBody.properties.email).not.toMatch(/@example\.invalid$/);
	});

	it("s3: corre api_key y oidc para cada modelo, y un error en una variante no frena a las demas", async () => {
		const tokenForSubject = vi
			.fn()
			.mockResolvedValue({ token: TOKEN, expiresAt: EXPIRES_AT });
		const fetch = vi.fn().mockResolvedValue(fakeResponse(200));
		const generate = vi
			.fn()
			.mockImplementation(async (model: string, auth: "api_key" | "oidc") => {
				if (model === "anthropic/claude-sonnet-5" && auth === "oidc") {
					throw new Error("gateway caido");
				}
				return { output: { ok: true }, usage: { totalTokens: 5 } };
			});
		const deps: ProbeDeps = {
			tokenForSubject,
			fetch,
			generate,
			now: () => 1000,
		};

		const steps = await runEtapa3Probes(baseInput(), deps);

		const s3Steps = steps.filter((step) => step.step.startsWith("s3."));
		expect(s3Steps).toHaveLength(6);

		const models = [
			"anthropic/claude-opus-5",
			"anthropic/claude-sonnet-5",
			"anthropic/claude-haiku-4.5",
		];
		for (const model of models) {
			expect(s3Steps.some((step) => step.step === `s3.api_key.${model}`)).toBe(
				true,
			);
			expect(s3Steps.some((step) => step.step === `s3.oidc.${model}`)).toBe(
				true,
			);
		}

		expect(generate).toHaveBeenCalledTimes(6);
		for (const model of models) {
			expect(generate).toHaveBeenCalledWith(model, "api_key");
			expect(generate).toHaveBeenCalledWith(model, "oidc");
		}

		const failed = s3Steps.find(
			(step) => step.step === "s3.oidc.anthropic/claude-sonnet-5",
		);
		expect(failed?.ok).toBe(false);
		expect(failed?.detail).toContain("gateway caido");

		const others = s3Steps.filter((step) => step !== failed);
		for (const step of others) {
			expect(step.ok).toBe(true);
		}
	});
});
