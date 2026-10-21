import { describe, expect, it } from "vitest";
import { formatPrice, parseGatewayCatalog } from "@/lib/tenants/gateway-models";

const catalog = {
	data: [
		{
			id: "openai/gpt-5",
			name: "GPT-5",
			owned_by: "openai",
			type: "language",
			pricing: { input: "0.00000125", output: "0.00001" },
		},
		{
			id: "anthropic/claude-sonnet-5",
			name: "Claude Sonnet 5",
			owned_by: "anthropic",
			type: "language",
			pricing: { input: "0.000003", output: "0.000015" },
		},
		{ id: "anthropic/claude-sonnet-5-batch", type: "language" },
		{ id: "openai/text-embedding-3", type: "embedding" },
		{ id: "google/imagen-4", type: "image" },
		{ id: "acme/sin-precio", type: "language" },
	],
};

describe("parseGatewayCatalog", () => {
	it("deja solo modelos de texto, sin variantes batch, ordenados", () => {
		expect(parseGatewayCatalog(catalog).map((m) => m.id)).toEqual([
			"acme/sin-precio",
			"anthropic/claude-sonnet-5",
			"openai/gpt-5",
		]);
	});

	it("pasa los precios a dólares por millón de tokens", () => {
		const [, sonnet] = parseGatewayCatalog(catalog);
		expect(sonnet).toMatchObject({
			vendor: "anthropic",
			inputPerMillion: 3,
			outputPerMillion: 15,
		});
	});

	it("devuelve vacío si la respuesta no tiene la forma esperada", () => {
		expect(parseGatewayCatalog(null)).toEqual([]);
		expect(parseGatewayCatalog({ data: "x" })).toEqual([]);
	});
});

describe("formatPrice", () => {
	it("muestra entrada y salida", () => {
		const [, sonnet, gpt] = parseGatewayCatalog(catalog);
		expect(formatPrice(sonnet)).toBe(
			"US$ 3 entrada · US$ 15 salida por millón de tokens",
		);
		expect(formatPrice(gpt)).toBe(
			"US$ 1.25 entrada · US$ 10 salida por millón de tokens",
		);
	});

	it("no inventa precio si el gateway no lo publica", () => {
		const [sinPrecio] = parseGatewayCatalog(catalog);
		expect(formatPrice(sinPrecio)).toBeNull();
	});
});
