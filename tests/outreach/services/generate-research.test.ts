// generateResearch se prueba con `generateText` inyectado: no llama al modelo.
// Verifica el cableado (tool leer_pagina, salida estructurada, tope de pasos) y
// qué ve el modelo de cada lectura.
import { NoOutputGeneratedError, generateText as realGenerateText } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { describe, expect, it, vi } from "vitest";
import { generateResearch } from "@/lib/outreach/services/generate-research";
import type { WebPageResult } from "@/lib/outreach/web-page";
import { metered } from "@/lib/workflows/usage";

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

	it("devuelve el consumo sumado de todos los pasos, no el del último", async () => {
		// En ai@7 result.providerMetadata es el del último paso: con dos lecturas,
		// el costo del gateway del primer paso se perdía.
		const generateText = (async (options: {
			onStepEnd: (step: unknown) => void;
		}) => {
			options.onStepEnd({
				usage: { inputTokens: 100, outputTokens: 20 },
				providerMetadata: { gateway: { cost: "0.002" } },
			});
			options.onStepEnd({
				usage: { inputTokens: 300, outputTokens: 50 },
				providerMetadata: { gateway: { cost: "0.005" } },
			});
			return {
				output: { name: "Acme" },
				usage: { inputTokens: 300, outputTokens: 50 },
				providerMetadata: { gateway: { cost: "0.005" } },
			};
		}) as never;

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

		expect(result.usage).toEqual({ inputTokens: 400, outputTokens: 70 });
		expect(
			Number(
				(result.providerMetadata as { gateway: { cost: string } }).gateway.cost,
			),
		).toBeCloseTo(0.007);
	});

	it("si el modelo termina sin salida, devuelve output undefined pero conserva usage", async () => {
		// result.output es un getter en ai@7: cuando el modelo no generó salida
		// estructurada, leerlo tira NoOutputGeneratedError recién ahí, después de
		// haber gastado tokens. metered (la puerta que envuelve generateResearch)
		// necesita que la promesa resuelva igual para poder asentar ese consumo.
		const usage = { inputTokens: 40, outputTokens: 0 };
		const providerMetadata = { gateway: { cost: "0.0004" } };
		const generateText = (async (options: {
			onStepEnd: (step: unknown) => void;
		}) => {
			options.onStepEnd({ usage, providerMetadata });
			return {
				get output() {
					throw new NoOutputGeneratedError();
				},
				usage,
				providerMetadata,
			};
		}) as never;

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
		expect(result.usage).toEqual(usage);
		expect(result.providerMetadata).toEqual(providerMetadata);
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

	it("si el abort corta un paso, los pasos ya cerrados quedan asentados y el error se relanza", async () => {
		// generateText real de ai@7 con un modelo falso: el primer paso pide
		// leer_pagina y cierra con su consumo; el segundo se queda colgado hasta
		// que el AbortSignal (el ITEM_TIMEOUT_MS de dispatch) lo corta.
		const controller = new AbortController();
		const step = (n: number) => ({
			inputTokens: {
				total: n,
				noCache: n,
				cacheRead: undefined,
				cacheWrite: undefined,
			},
			outputTokens: { total: 20, text: 20, reasoning: undefined },
		});
		let calls = 0;
		const model = new MockLanguageModelV4({
			doGenerate: async (options) => {
				calls++;
				if (calls === 1) {
					return {
						content: [
							{
								type: "tool-call",
								toolCallId: "c1",
								toolName: "leer_pagina",
								input: JSON.stringify({ url: "https://acme.test/" }),
							},
						],
						finishReason: { unified: "tool-calls", raw: undefined },
						usage: step(1_000),
						providerMetadata: { gateway: { cost: "0.004" } },
						warnings: [],
					};
				}
				setTimeout(() => controller.abort(new Error("timeout del ítem")), 5);
				return new Promise((_, reject) =>
					options.abortSignal?.addEventListener("abort", () =>
						reject(options.abortSignal?.reason),
					),
				);
			},
		});
		const generateText = ((options: Record<string, unknown>) =>
			realGenerateText({ ...options, model } as never)) as never;
		const record = vi.fn(async () => {});
		const generate = metered(
			(args: Parameters<typeof generateResearch>[0]) =>
				generateResearch(args, {
					generateText,
					abortSignal: controller.signal,
				}),
			{
				model: (args) => args.model,
				record,
				base: {
					tenantId: "t1",
					runId: "r1",
					workflow: "refresh-fichas",
					node: "outreach/research",
				},
			},
		);

		await expect(
			generate({
				model: "anthropic/claude-haiku-4.5",
				system: "s",
				prompt: "p",
				readPage: async (url) => ({
					ok: true,
					page: {
						url,
						status: 200,
						title: "Acme",
						text: "Envases",
						truncated: false,
					},
				}),
			}),
		).rejects.toThrow("timeout del ítem");

		expect(calls).toBe(2);
		expect(record).toHaveBeenCalledOnce();
		expect(record).toHaveBeenCalledWith(
			expect.objectContaining({
				tenantId: "t1",
				node: "outreach/research",
				resource: "model_usd",
				amount: 0.004,
				meta: {
					model: "anthropic/claude-haiku-4.5",
					source: "gateway",
					inputTokens: 1_000,
					outputTokens: 20,
					failed: true,
				},
			}),
		);
	});
});
