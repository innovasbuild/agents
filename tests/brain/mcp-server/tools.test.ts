// Server MCP del brain en aislamiento: sin HTTP, un par de transportes en
// memoria. handler.test.ts ya cubre el camino completo por HTTP; acá se
// prueba server.ts solo (spec etapa 11 §5.3).
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it, vi } from "vitest";
import { BrainError, BrainNotFound } from "@/lib/brain/core/errors";
import type { RateLimiter } from "@/lib/brain/core/mcp-server/rate-limit";
import {
	buildBrainMcpServer,
	MCP_MAX_UPSERT_BODY_BYTES,
} from "@/lib/brain/core/mcp-server/server";
import type { SkillCatalog } from "@/lib/brain/core/skills/catalog";
import type { BrainProvider } from "@/lib/brain/core/types";

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
		list: async () => [],
		history: async () => null,
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
	it("expone siempre las tres tools: el permiso lo decide el proveedor, no el rol", async () => {
		const provider = fakeProvider();
		const server = buildBrainMcpServer({
			userId: "ana",
			categories: ["comercial"],
			canon: false,
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
			categories: ["comercial"],
			canon: false,
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
			categories: ["comercial"],
			canon: false,
			provider,
			limiter,
		});
		const client = await connect(server);
		await client.callTool({ name: "brain_search", arguments: { query: "x" } });
		expect(limiter.check).toHaveBeenCalledWith("read");

		const writeServer = buildBrainMcpServer({
			userId: "admin",
			categories: ["comercial"],
			canon: false,
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
			categories: ["comercial"],
			canon: false,
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
			categories: ["comercial"],
			canon: false,
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
			categories: ["comercial"],
			canon: false,
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

function fakeCatalog(over: Partial<SkillCatalog> = {}): SkillCatalog {
	return {
		list: () => [
			{
				name: "reporte",
				description: "Arma el reporte mensual.",
				version: 2,
				publishedAt: "2026-10-13T12:00:00Z",
			},
		],
		load: vi.fn(async (name: string) => ({
			name,
			description: "Arma el reporte mensual.",
			version: 2,
			publishedAt: "2026-10-13T12:00:00Z",
			digest: "dg",
			instructions: "# Pasos",
			files: [],
		})),
		file: vi.fn(async (name: string, path: string) => ({
			name,
			version: 2,
			path,
			size: 4,
			content: "hola",
		})),
		...over,
	};
}

function build(skills: SkillCatalog | null, limiter = fakeLimiter()) {
	return buildBrainMcpServer({
		userId: "ana",
		categories: ["comercial"],
		canon: false,
		provider: fakeProvider(),
		limiter,
		skills,
	});
}

describe("tools de skills", () => {
	it("sin catálogo no hay tools de skills ni instrucciones", async () => {
		const client = await connect(build(null));
		expect((await client.listTools()).tools.map((t) => t.name).sort()).toEqual([
			"brain_read",
			"brain_search",
			"brain_upsert",
		]);
		expect(client.getInstructions()).toBeUndefined();
	});

	it("con catálogo aparecen las tres, las instrucciones y la lista en skill_load", async () => {
		const client = await connect(build(fakeCatalog()));
		const tools = (await client.listTools()).tools;
		expect(tools.map((t) => t.name).sort()).toEqual([
			"brain_read",
			"brain_search",
			"brain_upsert",
			"skill_file",
			"skill_list",
			"skill_load",
		]);
		expect(tools.find((t) => t.name === "skill_load")?.description).toContain(
			"- reporte: Arma el reporte mensual.",
		);
		expect(client.getInstructions()).toContain("skill_load");
	});

	it("skill_list, skill_load y skill_file devuelven el resultado del catálogo y cuentan como lectura", async () => {
		const limiter = fakeLimiter();
		const catalog = fakeCatalog();
		const client = await connect(build(catalog, limiter));
		const list = await client.callTool({ name: "skill_list", arguments: {} });
		expect(list.structuredContent).toEqual({
			ok: true,
			skills: catalog.list(),
		});
		const load = await client.callTool({
			name: "skill_load",
			arguments: { name: "reporte" },
		});
		expect(load.structuredContent).toMatchObject({
			ok: true,
			name: "reporte",
			instructions: "# Pasos",
		});
		const file = await client.callTool({
			name: "skill_file",
			arguments: { name: "reporte", path: "a.md" },
		});
		expect(file.structuredContent).toEqual({
			ok: true,
			name: "reporte",
			version: 2,
			path: "a.md",
			size: 4,
			content: "hola",
		});
		expect(limiter.check.mock.calls.map((call) => call[0])).toEqual([
			"read",
			"read",
			"read",
		]);
	});

	it("un error del catálogo sale con el formato de las tools del brain", async () => {
		const client = await connect(
			build(
				fakeCatalog({
					load: async () => {
						throw new BrainError("not_found", "No existe la skill.");
					},
				}),
			),
		);
		const result = await client.callTool({
			name: "skill_load",
			arguments: { name: "x" },
		});
		expect(result.isError).toBe(true);
		expect(result.structuredContent).toEqual({
			ok: false,
			error: "not_found",
			message: "No existe la skill.",
		});
	});
});
