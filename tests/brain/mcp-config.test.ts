import { describe, expect, it } from "vitest";
import { parseMcpBrainConfig } from "@/lib/brain/mcp-config";

const base = {
	url: "https://brain.cliente.test/mcp",
	categories: ["comercial"],
};

describe("parseMcpBrainConfig", () => {
	it("completa defaults: nombres del contrato, 10 s y límites", () => {
		expect(parseMcpBrainConfig(base, "production")).toEqual({
			url: "https://brain.cliente.test/mcp",
			tools: {
				search: "brain_search",
				read: "brain_read",
				upsert: "brain_upsert",
			},
			categories: ["comercial"],
			timeoutMs: 10000,
			mcpLimits: { readsPerMinute: 60, writesPerMinute: 10 },
		});
	});

	it("acepta un mapeo parcial de nombres", () => {
		expect(
			parseMcpBrainConfig(
				{ ...base, tools: { read: "get_page" } },
				"production",
			).tools,
		).toEqual({
			search: "brain_search",
			read: "get_page",
			upsert: "brain_upsert",
		});
	});

	it("exige https, salvo localhost fuera de producción", () => {
		expect(() =>
			parseMcpBrainConfig(
				{ ...base, url: "http://brain.cliente.test/mcp" },
				"production",
			),
		).toThrow("https");
		expect(() =>
			parseMcpBrainConfig(
				{ ...base, url: "http://localhost:4000/mcp" },
				"production",
			),
		).toThrow("https");
		expect(
			parseMcpBrainConfig(
				{ ...base, url: "http://localhost:4000/mcp" },
				"development",
			).url,
		).toBe("http://localhost:4000/mcp");
	});

	it("valida timeout, nombres de tools, categorías y claves", () => {
		expect(() =>
			parseMcpBrainConfig({ ...base, timeoutMs: 500 }, "production"),
		).toThrow("timeoutMs");
		expect(() =>
			parseMcpBrainConfig({ ...base, timeoutMs: 31000 }, "production"),
		).toThrow("timeoutMs");
		expect(() =>
			parseMcpBrainConfig(
				{ ...base, tools: { search: "con espacios" } },
				"production",
			),
		).toThrow("tools.search");
		expect(() => parseMcpBrainConfig({ url: base.url }, "production")).toThrow(
			"categories",
		);
		expect(() =>
			parseMcpBrainConfig({ ...base, secreto: "x" }, "production"),
		).toThrow("secreto");
	});
});
