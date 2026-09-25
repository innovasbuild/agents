// Server MCP del brain en aislamiento: sin HTTP, un par de transportes en
// memoria. handler.test.ts ya cubre el camino completo por HTTP; acá se
// prueba server.ts solo (spec etapa 11 §5.3).
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it, vi } from "vitest";
import { BrainNotFound } from "@/lib/brain/errors";
import type { RateLimiter } from "@/lib/brain/mcp-server/rate-limit";
import {
	buildBrainMcpServer,
	MCP_MAX_UPSERT_BODY_BYTES,
} from "@/lib/brain/mcp-server/server";
import type { BrainProvider } from "@/lib/brain/types";

const page = {
	slug: "comercial/icp",
	title: "ICP",
	category: "comercial",
	status: "activo" as const,
	tags: [],
	frontmatter: {},
	body: "hola",
	revision: 1,
	updatedAt: "2026-09-24T00:00:00Z",
};

function fakeProvider(): BrainProvider {
	return {
		search: vi.fn(async () => []),
		read: vi.fn(async () => page),
		upsert: vi.fn(async () => ({ slug: "comercial/icp", revision: 2 })),
	};
}

function fakeLimiter(): RateLimiter & { check: ReturnType<typeof vi.fn> } {
	return { check: vi.fn(async () => {}) };
}

async function connect(server: ReturnType<typeof buildBrainMcpServer>) {
	const [clientTransport, serverTransport] =
		InMemoryTransport.createLinkedPair();
	await server.connect(serverTransport);
	const client = new Client({ name: "test", version: "1.0.0" });
	await client.connect(clientTransport);
	return client;
}

describe("buildBrainMcpServer", () => {
	it("con acceso read expone solo brain_search y brain_read", async () => {
		const provider = fakeProvider();
		const server = buildBrainMcpServer({
			userId: "ana",
			access: "read",
			categories: ["comercial"],
			provider,
			limiter: fakeLimiter(),
		});
		const client = await connect(server);
		const names = (await client.listTools()).tools.map((t) => t.name).sort();
		expect(names).toEqual(["brain_read", "brain_search"]);
	});

	it("con acceso read_write agrega brain_upsert", async () => {
		const provider = fakeProvider();
		const server = buildBrainMcpServer({
			userId: "admin",
			access: "read_write",
			categories: ["comercial"],
			provider,
			limiter: fakeLimiter(),
		});
		const client = await connect(server);
		const names = (await client.listTools()).tools.map((t) => t.name).sort();
		expect(names).toEqual(["brain_read", "brain_search", "brain_upsert"]);
	});

	it("brain_read devuelve la página tal cual la da el proveedor", async () => {
		const provider = fakeProvider();
		const server = buildBrainMcpServer({
			userId: "ana",
			access: "read",
			categories: ["comercial"],
			provider,
			limiter: fakeLimiter(),
		});
		const client = await connect(server);
		const result = await client.callTool({
			name: "brain_read",
			arguments: { slug: "comercial/icp" },
		});
		expect(result.structuredContent).toEqual({ ok: true, page });
		expect(provider.read).toHaveBeenCalledWith("comercial/icp");
	});

	it("el límite se chequea antes de llamar al proveedor, con el kind correcto", async () => {
		const provider = fakeProvider();
		const limiter = fakeLimiter();
		const server = buildBrainMcpServer({
			userId: "ana",
			access: "read",
			categories: ["comercial"],
			provider,
			limiter,
		});
		const client = await connect(server);
		await client.callTool({ name: "brain_search", arguments: { query: "x" } });
		expect(limiter.check).toHaveBeenCalledWith("read");

		const writeServer = buildBrainMcpServer({
			userId: "admin",
			access: "read_write",
			categories: ["comercial"],
			provider,
			limiter,
		});
		const writeClient = await connect(writeServer);
		await writeClient.callTool({
			name: "brain_upsert",
			arguments: {
				slug: "comercial/icp",
				title: "ICP",
				category: "comercial",
				status: "activo",
				tags: [],
				body: "x",
				reason: "r",
			},
		});
		expect(limiter.check).toHaveBeenCalledWith("write");
	});

	it("un cuerpo de más de 100 KB no llega al proveedor", async () => {
		const provider = fakeProvider();
		const server = buildBrainMcpServer({
			userId: "admin",
			access: "read_write",
			categories: ["comercial"],
			provider,
			limiter: fakeLimiter(),
		});
		const client = await connect(server);
		const result = await client.callTool({
			name: "brain_upsert",
			arguments: {
				slug: "comercial/icp",
				title: "ICP",
				category: "comercial",
				status: "activo",
				tags: [],
				body: "x".repeat(MCP_MAX_UPSERT_BODY_BYTES + 1),
				reason: "r",
			},
		});
		expect(result.isError).toBe(true);
		expect(result.structuredContent).toMatchObject({
			ok: false,
			error: "validation",
			fields: ["body"],
		});
		expect(provider.upsert).not.toHaveBeenCalled();
	});

	it("un BrainError tipado sale como isError con la forma de toToolError", async () => {
		const provider = fakeProvider();
		vi.mocked(provider.read).mockRejectedValueOnce(
			new BrainNotFound("comercial/nope", ["comercial/icp"]),
		);
		const server = buildBrainMcpServer({
			userId: "ana",
			access: "read",
			categories: ["comercial"],
			provider,
			limiter: fakeLimiter(),
		});
		const client = await connect(server);
		const result = await client.callTool({
			name: "brain_read",
			arguments: { slug: "comercial/nope" },
		});
		expect(result.isError).toBe(true);
		expect(result.structuredContent).toMatchObject({
			ok: false,
			error: "not_found",
			suggestions: ["comercial/icp"],
		});
	});

	it("un error no tipado sale como internal con un id, sin filtrar el detalle", async () => {
		const provider = fakeProvider();
		vi.mocked(provider.search).mockRejectedValueOnce(
			new Error("password=hunter2"),
		);
		const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
		const server = buildBrainMcpServer({
			userId: "ana",
			access: "read",
			categories: ["comercial"],
			provider,
			limiter: fakeLimiter(),
		});
		const client = await connect(server);
		const result = await client.callTool({
			name: "brain_search",
			arguments: { query: "x" },
		});
		expect(result.isError).toBe(true);
		expect(JSON.stringify(result)).not.toContain("hunter2");
		expect(result.structuredContent).toMatchObject({
			ok: false,
			error: "internal",
		});
		errorLog.mockRestore();
	});
});
