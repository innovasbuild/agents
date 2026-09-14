import { afterEach, describe, expect, it, vi } from "vitest";
import { GmailUnauthorizedError, sendMail } from "@/lib/gmail/send";

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
});
