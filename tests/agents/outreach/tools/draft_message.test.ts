// generateDraft (Fix round 1, hallazgo 1): ai@7.0.98 tira NoObjectGeneratedError
// en vez de resolver cuando el JSON viene roto, no cierra o se corta por
// maxOutputTokens (node_modules/ai/dist/index.js, generate-text/output.ts).
// Sin esto, ese fallo del modelo terminaba en excepción en vez de consumir un
// intento del gate. Se prueba con `generateText` inyectado: no llama al modelo.
import { NoObjectGeneratedError } from "ai";
import { describe, expect, it } from "vitest";
import { generateDraft } from "@/agents/outreach/tools/draft_message";

const responseStub = {
	id: "r1",
	timestamp: new Date("2026-09-15T00:00:00Z"),
	modelId: "m1",
};
const usageStub = {
	inputTokens: 10,
	inputTokenDetails: {
		noCacheTokens: 10,
		cacheReadTokens: undefined,
		cacheWriteTokens: undefined,
	},
	outputTokens: 5,
	outputTokenDetails: { textTokens: 5, reasoningTokens: undefined },
	totalTokens: 15,
};

describe("generateDraft", () => {
	it("con una respuesta válida, pasa el output y el usage de generateText", async () => {
		const output = { subject: "s", body: "b" };
		const generateText = (async () => ({ output, usage: usageStub })) as never;
		expect(
			await generateDraft("m", "system", "prompt", { generateText }),
		).toEqual({
			output,
			usage: usageStub,
		});
	});

	it("ante NoObjectGeneratedError con texto parseable, devuelve el JSON parseado en vez de tirar", async () => {
		const error = new NoObjectGeneratedError({
			text: '{"subject":"s","body":"b"}',
			response: responseStub,
			usage: usageStub,
			finishReason: "stop",
		});
		const generateText = (async () => {
			throw error;
		}) as never;
		expect(
			await generateDraft("m", "system", "prompt", { generateText }),
		).toEqual({
			output: { subject: "s", body: "b" },
			usage: usageStub,
		});
	});

	it("ante NoObjectGeneratedError sin texto parseable (cortado por maxOutputTokens), devuelve output null", async () => {
		const error = new NoObjectGeneratedError({
			text: '{"subject":"s","body": "cortado a la mit',
			response: responseStub,
			usage: usageStub,
			finishReason: "length",
		});
		const generateText = (async () => {
			throw error;
		}) as never;
		expect(
			await generateDraft("m", "system", "prompt", { generateText }),
		).toEqual({
			output: null,
			usage: usageStub,
		});
	});

	it("ante NoObjectGeneratedError sin texto, devuelve output y usage null si tampoco hay usage", async () => {
		const error = new NoObjectGeneratedError({
			response: responseStub,
			usage: undefined as never,
			finishReason: "error",
		});
		const generateText = (async () => {
			throw error;
		}) as never;
		expect(
			await generateDraft("m", "system", "prompt", { generateText }),
		).toEqual({
			output: null,
			usage: null,
		});
	});

	it("cualquier otro error se relanza", async () => {
		const generateText = (async () => {
			throw new Error("timeout de red");
		}) as never;
		await expect(
			generateDraft("m", "system", "prompt", { generateText }),
		).rejects.toThrow("timeout de red");
	});
});
