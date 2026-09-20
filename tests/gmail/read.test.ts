import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchThread, findByRfc822Id } from "@/lib/gmail/read";
import { GmailUnauthorizedError } from "@/lib/gmail/send";

afterEach(() => vi.unstubAllGlobals());

const b64 = (text: string) => Buffer.from(text, "utf8").toString("base64url");

const message = (over: Record<string, unknown> = {}) => ({
	id: "m1",
	threadId: "t1",
	snippet: "hola",
	payload: {
		headers: [
			{ name: "From", value: "ana@acme.test" },
			{ name: "Date", value: "Mon, 14 Sep 2026 10:00:00 -0300" },
			{ name: "Message-ID", value: "<ana-1@acme.test>" },
		],
		body: { data: b64("Cuerpo de la respuesta") },
	},
	...over,
});

const threadResponse = (messages: unknown[]) =>
	Response.json({ id: "t1", messages });

describe("fetchThread", () => {
	it("marca como nuestro el mensaje que sale de la casilla del ejecutor", async () => {
		vi.stubGlobal("fetch", async () =>
			threadResponse([
				message({
					payload: {
						headers: [
							{ name: "From", value: "Mati <mati@innov.as>" },
							{ name: "Message-ID", value: "<mio-1@innov.as>" },
						],
						body: { data: b64("Mi mensaje") },
					},
				}),
			]),
		);

		const [msg] = await fetchThread("tok", "t1", "mati@innov.as");

		expect(msg.isFromUs).toBe(true);
	});

	it("marca como ajeno el mensaje de otra casilla", async () => {
		vi.stubGlobal("fetch", async () => threadResponse([message()]));

		const [msg] = await fetchThread("tok", "t1", "mati@innov.as");

		expect(msg.isFromUs).toBe(false);
	});

	it("extrae el Message-ID RFC822, que es lo que necesita el follow-up", async () => {
		vi.stubGlobal("fetch", async () => threadResponse([message()]));

		const [msg] = await fetchThread("tok", "t1", "mati@innov.as");

		expect(msg.rfc822MessageId).toBe("<ana-1@acme.test>");
	});

	it("detecta un rebote por el remitente mailer-daemon", async () => {
		vi.stubGlobal("fetch", async () =>
			threadResponse([
				message({
					payload: {
						headers: [
							{
								name: "From",
								value: "Mail Delivery Subsystem <mailer-daemon@googlemail.com>",
							},
						],
						body: { data: b64("Address not found") },
					},
				}),
			]),
		);

		const [msg] = await fetchThread("tok", "t1", "mati@innov.as");

		expect(msg.isBounce).toBe(true);
	});

	it("detecta un rebote por la parte message/delivery-status", async () => {
		vi.stubGlobal("fetch", async () =>
			threadResponse([
				message({
					payload: {
						headers: [{ name: "From", value: "postmaster@acme.test" }],
						mimeType: "multipart/report",
						parts: [{ mimeType: "message/delivery-status", body: {} }],
					},
				}),
			]),
		);

		const [msg] = await fetchThread("tok", "t1", "mati@innov.as");

		expect(msg.isBounce).toBe(true);
	});

	it("detecta una respuesta automática por Auto-Submitted", async () => {
		vi.stubGlobal("fetch", async () =>
			threadResponse([
				message({
					payload: {
						headers: [
							{ name: "From", value: "ana@acme.test" },
							{ name: "Auto-Submitted", value: "auto-replied" },
						],
						body: { data: b64("Estoy de vacaciones hasta el 3") },
					},
				}),
			]),
		);

		const [msg] = await fetchThread("tok", "t1", "mati@innov.as");

		expect(msg.isAutoReply).toBe(true);
	});

	it("lee el cuerpo de un mensaje multipart, no solo del body directo", async () => {
		vi.stubGlobal("fetch", async () =>
			threadResponse([
				message({
					payload: {
						headers: [{ name: "From", value: "ana@acme.test" }],
						mimeType: "multipart/alternative",
						parts: [
							{ mimeType: "text/plain", body: { data: b64("Texto plano") } },
							{ mimeType: "text/html", body: { data: b64("<p>HTML</p>") } },
						],
					},
				}),
			]),
		);

		const [msg] = await fetchThread("tok", "t1", "mati@innov.as");

		expect(msg.body).toBe("Texto plano");
	});

	it("un 401 tira GmailUnauthorizedError, igual que el envío", async () => {
		vi.stubGlobal("fetch", async () => new Response("{}", { status: 401 }));

		await expect(
			fetchThread("tok", "t1", "mati@innov.as"),
		).rejects.toBeInstanceOf(GmailUnauthorizedError);
	});

	it("un hilo sin mensajes devuelve lista vacía, no explota", async () => {
		vi.stubGlobal("fetch", async () => Response.json({ id: "t1" }));

		expect(await fetchThread("tok", "t1", "mati@innov.as")).toEqual([]);
	});
});

describe("findByRfc822Id", () => {
	it("devuelve el mensaje cuando la búsqueda lo encuentra", async () => {
		vi.stubGlobal("fetch", async () =>
			Response.json({ messages: [{ id: "m9", threadId: "t9" }] }),
		);

		expect(await findByRfc822Id("tok", "<x@y.test>")).toEqual({
			id: "m9",
			threadId: "t9",
		});
	});

	it("devuelve null cuando no hay resultados", async () => {
		vi.stubGlobal("fetch", async () => Response.json({}));

		expect(await findByRfc822Id("tok", "<x@y.test>")).toBeNull();
	});
});
