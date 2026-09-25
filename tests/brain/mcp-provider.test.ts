import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
	BrainConflict,
	BrainNotFound,
	BrainProviderError,
} from "@/lib/brain/errors";
import { createMcpBrainProvider } from "@/lib/brain/mcp";
import type { McpBrainConfig } from "@/lib/brain/mcp-config";

const page = {
	slug: "comercial/icp",
	title: "ICP",
	category: "comercial",
	status: "activo",
	tags: ["canon:icp"],
	frontmatter: {},
	body: "…",
	revision: 3,
	updatedAt: "2026-09-24T00:00:00Z",
};

function json(value: unknown, isError = false) {
	return {
		content: [{ type: "text" as const, text: JSON.stringify(value) }],
		structuredContent: value as Record<string, unknown>,
		...(isError ? { isError: true } : {}),
	};
}

type Handlers = Record<
	string,
	(args: Record<string, unknown>) => Promise<ReturnType<typeof json>>
>;

function remote(
	handlers: Handlers,
	calls: { name: string; args: unknown }[] = [],
) {
	return async () => {
		const server = new McpServer({ name: "remoto", version: "1.0.0" });
		for (const [name, handler] of Object.entries(handlers)) {
			server.registerTool(
				name,
				{ inputSchema: z.object({}).passthrough() },
				async (args) => {
					calls.push({ name, args });
					return handler(args as Record<string, unknown>);
				},
			);
		}
		const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
		await server.connect(serverSide);
		return clientSide;
	};
}

const config: McpBrainConfig = {
	url: "https://brain.cliente.test/mcp",
	tools: { search: "brain_search", read: "brain_read", upsert: "brain_upsert" },
	categories: ["comercial"],
	timeoutMs: 1000,
	mcpLimits: { readsPerMinute: 60, writesPerMinute: 10 },
};

describe("createMcpBrainProvider", () => {
	it("busca, lee y escribe contra el servidor remoto", async () => {
		const calls: { name: string; args: unknown }[] = [];
		const provider = createMcpBrainProvider({
			config,
			transport: remote(
				{
					brain_search: async () => json({ ok: true, results: [] }),
					brain_read: async () => json({ ok: true, page }),
					brain_upsert: async () =>
						json({ ok: true, slug: "comercial/icp", revision: 4 }),
				},
				calls,
			),
		});

		expect(await provider.search({ query: "icp" })).toEqual([]);
		expect(await provider.read("comercial/icp")).toEqual(page);
		expect(
			await provider.upsert(
				{
					slug: "comercial/icp",
					title: "ICP",
					category: "comercial",
					status: "activo",
					tags: [],
					body: "x",
					reason: "ajuste",
					baseRevision: 3,
				},
				{ kind: "agent", userId: null, sessionId: "s1" },
			),
		).toEqual({ slug: "comercial/icp", revision: 4 });

		expect(calls.map((call) => call.name)).toEqual([
			"brain_search",
			"brain_read",
			"brain_upsert",
		]);
		expect(calls[1]?.args).toEqual({ slug: "comercial/icp" });
		expect(calls[2]?.args).not.toHaveProperty("author");
	});

	it("usa los nombres mapeados en la config", async () => {
		const calls: { name: string; args: unknown }[] = [];
		const provider = createMcpBrainProvider({
			config: { ...config, tools: { ...config.tools, read: "get_page" } },
			transport: remote(
				{ get_page: async () => json({ ok: true, page }) },
				calls,
			),
		});
		await provider.read("comercial/icp");
		expect(calls[0]?.name).toBe("get_page");
	});

	it("una respuesta mal formada es un error del proveedor, no un dato a medias", async () => {
		const provider = createMcpBrainProvider({
			config,
			transport: remote({
				brain_read: async () => json({ ok: true, page: { slug: "x" } }),
			}),
		});
		await expect(provider.read("x")).rejects.toBeInstanceOf(BrainProviderError);
	});

	it("traduce los errores tipados del remoto", async () => {
		const provider = createMcpBrainProvider({
			config,
			transport: remote({
				brain_read: async () =>
					json(
						{
							ok: false,
							error: "not_found",
							message: "no",
							suggestions: ["comercial/icp-v2"],
						},
						true,
					),
				brain_upsert: async () =>
					json(
						{
							ok: false,
							error: "conflict",
							message: "cambió",
							currentRevision: 5,
						},
						true,
					),
			}),
		});
		const notFound = await provider
			.read("comercial/icp")
			.catch((error) => error);
		expect(notFound).toBeInstanceOf(BrainNotFound);
		expect(notFound.suggestions).toEqual(["comercial/icp-v2"]);

		const conflict = await provider
			.upsert(
				{
					slug: "comercial/icp",
					title: "ICP",
					category: "comercial",
					status: "activo",
					tags: [],
					body: "x",
					reason: "r",
					baseRevision: 3,
				},
				{ kind: "agent", userId: null, sessionId: "s1" },
			)
			.catch((error) => error);
		expect(conflict).toBeInstanceOf(BrainConflict);
		expect(conflict.currentRevision).toBe(5);
	});

	it("un código de error desconocido es un error del proveedor", async () => {
		const provider = createMcpBrainProvider({
			config,
			transport: remote({
				brain_read: async () => json({ ok: false, error: "explotó" }, true),
			}),
		});
		await expect(provider.read("x")).rejects.toBeInstanceOf(BrainProviderError);
	});

	it("un remoto que no contesta corta por timeout", async () => {
		const provider = createMcpBrainProvider({
			config: { ...config, timeoutMs: 50 },
			transport: remote({ brain_read: () => new Promise(() => {}) }),
		});
		await expect(provider.read("x")).rejects.toBeInstanceOf(BrainProviderError);
	});

	it("un transporte que no conecta es un error del proveedor", async () => {
		const provider = createMcpBrainProvider({
			config,
			transport: async () => {
				throw new Error("ECONNREFUSED");
			},
		});
		await expect(provider.search({ query: "" })).rejects.toBeInstanceOf(
			BrainProviderError,
		);
	});
});
