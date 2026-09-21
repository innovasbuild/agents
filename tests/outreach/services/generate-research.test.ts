// generateResearch se prueba con `generateText` inyectado: no llama al modelo.
// Verifica el cableado (tool leer_pagina, salida estructurada, tope de pasos) y
// qué ve el modelo de cada lectura.
import { NoOutputGeneratedError } from "ai";
import { describe, expect, it } from "vitest";
import { generateResearch } from "@/lib/outreach/services/generate-research";
import type { WebPageResult } from "@/lib/outreach/web-page";

type LeerPagina = {
	execute: (input: { url: string }, options: unknown) => Promise<unknown>;
};

describe("generateResearch", () => {
	it("arma la llamada con leer_pagina, Output.object y tope de pasos, y devuelve el output", async () => {
		const seen: Record<string, unknown>[] = [];
		const toModel: unknown[] = [];
		const generateText = (async (options: Record<string, unknown>) => {
			seen.push(options);
			const tools = options.tools as { leer_pagina: LeerPagina };
			toModel.push(
				await tools.leer_pagina.execute({ url: "https://acme.test/" }, {}),
			);
			toModel.push(
				await tools.leer_pagina.execute({ url: "http://10.0.0.1/" }, {}),
			);
			return { output: { name: "Acme" } };
		}) as never;
		const readPage = async (url: string): Promise<WebPageResult> =>
			url.startsWith("https://acme.test")
				? {
						ok: true,
						page: {
							url,
							status: 200,
							title: "Acme",
							text: "Envases",
							truncated: false,
						},
					}
				: { ok: false, reason: "url_no_permitida", message: "no" };

		const result = await generateResearch(
			{ model: "m", system: "s", prompt: "p", readPage },
			{ generateText },
		);

		expect(result).toEqual({ output: { name: "Acme" }, pagesRead: 1 });
		expect(seen[0]).toMatchObject({
			model: "m",
			system: "s",
			prompt: "p",
			maxOutputTokens: 4_000,
		});
		expect(seen[0].output).toBeDefined();
		expect(seen[0].stopWhen).toBeDefined();
		expect(toModel).toEqual([
			{
				ok: true,
				url: "https://acme.test/",
				title: "Acme",
				text: "Envases",
				truncated: false,
			},
			{ ok: false, reason: "url_no_permitida", message: "no" },
		]);
	});

	it("devuelve usage y providerMetadata para que la puerta asiente el consumo", async () => {
		const usage = { inputTokens: 100, outputTokens: 20 };
		const providerMetadata = { gateway: { cost: "0.002" } };
		const generateText = (async () => ({
			output: { name: "Acme" },
			usage,
			providerMetadata,
		})) as never;

		const result = await generateResearch(
			{
				model: "anthropic/claude-haiku-4.5",
				system: "s",
				prompt: "p",
				readPage: async () => ({
					ok: false as const,
					reason: "x",
					message: "x",
				}),
			},
			{ generateText },
		);

		expect(result.usage).toBe(usage);
		expect(result.providerMetadata).toBe(providerMetadata);
	});

	it("si el modelo termina sin salida, devuelve output undefined pero conserva usage", async () => {
		// result.output es un getter en ai@7: cuando el modelo no generó salida
		// estructurada, leerlo tira NoOutputGeneratedError recién ahí, después de
		// haber gastado tokens. metered (la puerta que envuelve generateResearch)
		// necesita que la promesa resuelva igual para poder asentar ese consumo.
		const usage = { inputTokens: 40, outputTokens: 0 };
		const providerMetadata = { gateway: { cost: "0.0004" } };
		const generateText = (async () => ({
			get output() {
				throw new NoOutputGeneratedError();
			},
			usage,
			providerMetadata,
		})) as never;

		const result = await generateResearch(
			{
				model: "m",
				system: "s",
				prompt: "p",
				readPage: async () => ({
					ok: false as const,
					reason: "x",
					message: "x",
				}),
			},
			{ generateText },
		);

		expect(result.output).toBeUndefined();
		expect(result.usage).toBe(usage);
		expect(result.providerMetadata).toBe(providerMetadata);
	});

	it("cualquier otro error al leer output se relanza", async () => {
		const generateText = (async () => ({
			get output() {
				throw new Error("otro error, no de output");
			},
			usage: {},
			providerMetadata: {},
		})) as never;

		await expect(
			generateResearch(
				{
					model: "m",
					system: "s",
					prompt: "p",
					readPage: async () => ({
						ok: false as const,
						reason: "x",
						message: "x",
					}),
				},
				{ generateText },
			),
		).rejects.toThrow("otro error, no de output");
	});
});
