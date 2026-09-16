import { afterEach, describe, expect, it, vi } from "vitest";
import {
	GmailUnauthorizedError,
	GmailUnknownOutcomeError,
	sendMail,
} from "@/lib/gmail/send";

afterEach(() => vi.unstubAllGlobals());

describe("sendMail", () => {
	it("envía con el access token recibido", async () => {
		const fetchMock = vi.fn(
			async (_input: RequestInfo | URL, _init?: RequestInit) =>
				Response.json({ id: "m1", threadId: "t1" }),
		);
		vi.stubGlobal("fetch", fetchMock);
		const result = await sendMail("tok", {
			to: "a@b.test",
			subject: "Hola",
			body: "Cuerpo",
		});
		expect(result).toEqual({ id: "m1", threadId: "t1" });
		const init = fetchMock.mock.calls[0][1];
		expect(new Headers(init?.headers).get("authorization")).toBe("Bearer tok");
	});

	it("un 401 tira GmailUnauthorizedError", async () => {
		vi.stubGlobal("fetch", async () => new Response("{}", { status: 401 }));
		await expect(
			sendMail("tok", { to: "a@b.test", subject: "x", body: "y" }),
		).rejects.toBeInstanceOf(GmailUnauthorizedError);
	});

	it("un 500 es un error común: Gmail contestó, el mail no salió", async () => {
		vi.stubGlobal("fetch", async () => new Response("boom", { status: 500 }));
		const error = await sendMail("tok", {
			to: "a@b.test",
			subject: "x",
			body: "y",
		}).catch((e) => e);
		expect(error).toBeInstanceOf(Error);
		expect(error).not.toBeInstanceOf(GmailUnknownOutcomeError);
		expect(error.message).toContain("500");
	});

	it("sin respuesta (red, abort, timeout) tira GmailUnknownOutcomeError", async () => {
		vi.stubGlobal("fetch", async () => {
			throw new Error("ECONNRESET");
		});
		await expect(
			sendMail("tok", { to: "a@b.test", subject: "x", body: "y" }),
		).rejects.toBeInstanceOf(GmailUnknownOutcomeError);
	});

	it("el fetch lleva un AbortSignal para que el timeout entre por ese carril", async () => {
		const fetchMock = vi.fn(
			async (_input: RequestInfo | URL, _init?: RequestInit) =>
				Response.json({ id: "m1", threadId: "t1" }),
		);
		vi.stubGlobal("fetch", fetchMock);
		await sendMail("tok", { to: "a@b.test", subject: "x", body: "y" });
		expect(fetchMock.mock.calls[0][1]?.signal).toBeInstanceOf(AbortSignal);
	});
});
