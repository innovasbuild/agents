import { describe, expect, it, vi } from "vitest";
import { resolveCrmOwnerId } from "@/lib/connectors/crm/owner";

const reply = (status: number, body: unknown) =>
	vi.fn(async () => new Response(JSON.stringify(body), { status }));

describe("resolveCrmOwnerId", () => {
	it("pregunta a HubSpot por el dueño con ese correo y devuelve su id", async () => {
		const fetchImpl = reply(200, {
			results: [{ id: "92296278", email: "ana@acme.test" }],
		});

		expect(await resolveCrmOwnerId("tok", "Ana@Acme.test", fetchImpl)).toBe(
			"92296278",
		);

		const [url, init] = fetchImpl.mock.calls[0] as unknown as [
			string,
			RequestInit,
		];
		expect(url).toBe(
			"https://api.hubapi.com/crm/v3/owners?email=ana%40acme.test&limit=2",
		);
		expect(init.headers).toEqual({ Authorization: "Bearer tok" });
	});

	it("el correo va codificado: no puede inyectar parámetros", async () => {
		const fetchImpl = reply(200, { results: [] });
		await resolveCrmOwnerId("tok", "a@b.test&archived=true", fetchImpl);
		const [url] = fetchImpl.mock.calls[0] as unknown as [string];
		expect(url).toContain("email=a%40b.test%26archived%3Dtrue&limit=2");
	});

	it.each([
		["sin resultados", 200, { results: [] }],
		[
			"el resultado es de otro correo",
			200,
			{ results: [{ id: "1", email: "otra@acme.test" }] },
		],
		[
			"dos dueños con ese correo",
			200,
			{
				results: [
					{ id: "1", email: "ana@acme.test" },
					{ id: "2", email: "ana@acme.test" },
				],
			},
		],
		["sin permiso para leer dueños", 403, { message: "scopes" }],
		["token rechazado", 401, {}],
		["HubSpot caído", 500, {}],
		["cuerpo inesperado", 200, { nada: true }],
	])("%s: null", async (_name, status, body) => {
		const log = vi.spyOn(console, "error").mockImplementation(() => {});
		try {
			expect(
				await resolveCrmOwnerId("tok", "ana@acme.test", reply(status, body)),
			).toBeNull();
		} finally {
			log.mockRestore();
		}
	});

	it("un error de red es null y se registra sin el token", async () => {
		const log = vi.spyOn(console, "error").mockImplementation(() => {});
		try {
			const fetchImpl = vi.fn(async () => {
				throw new Error("red");
			});
			expect(
				await resolveCrmOwnerId("tok-secreto", "ana@acme.test", fetchImpl),
			).toBeNull();
			expect(JSON.stringify(log.mock.calls)).not.toContain("tok-secreto");
		} finally {
			log.mockRestore();
		}
	});

	it("sin correo no pregunta", async () => {
		const fetchImpl = reply(200, { results: [] });
		expect(await resolveCrmOwnerId("tok", "", fetchImpl)).toBeNull();
		expect(fetchImpl).not.toHaveBeenCalled();
	});
});
