// Servidor MCP del brain para una persona autenticada (spec etapa 11 §5.3).
// Escribe una persona, no el agente: brain_upsert sin aprobación (D5).
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { BRAIN_TOOL_NAMES, brainContract } from "../contract.ts";
import { BrainError, BrainValidation, toToolError } from "../errors.ts";
import type { BrainProvider } from "../types.ts";
import type { RateLimiter } from "./rate-limit.ts";

export const MCP_MAX_REQUEST_BYTES = 1_048_576;
export const MCP_MAX_UPSERT_BODY_BYTES = 102_400;

function result(value: Record<string, unknown>, isError = false) {
	return {
		content: [{ type: "text" as const, text: JSON.stringify(value) }],
		structuredContent: value,
		...(isError ? { isError: true } : {}),
	};
}

export function buildBrainMcpServer(ctx: {
	userId: string;
	access: "read" | "read_write";
	categories: string[];
	provider: BrainProvider;
	limiter: RateLimiter;
}): McpServer {
	const server = new McpServer({ name: "innovas-brain", version: "1.0.0" });
	const contract = brainContract(ctx.categories);

	async function run(
		kind: "read" | "write",
		work: () => Promise<Record<string, unknown>>,
	) {
		try {
			await ctx.limiter.check(kind);
			return result(await work());
		} catch (error) {
			if (error instanceof BrainError)
				return result({ ...toToolError(error) }, true);
			const errorId = crypto.randomUUID();
			console.error(`brain mcp: error interno ${errorId}`, error);
			return result(
				{
					ok: false,
					error: "internal",
					message: `Error interno (${errorId}).`,
					errorId,
				},
				true,
			);
		}
	}

	server.registerTool(
		BRAIN_TOOL_NAMES.search,
		{
			description: contract.search.description,
			inputSchema: contract.search.input,
		},
		async (input) =>
			run("read", async () => ({
				ok: true,
				results: await ctx.provider.search(input),
			})),
	);

	server.registerTool(
		BRAIN_TOOL_NAMES.read,
		{
			description: contract.read.description,
			inputSchema: contract.read.input,
		},
		async ({ slug }) =>
			run("read", async () => ({
				ok: true,
				page: await ctx.provider.read(slug),
			})),
	);

	if (ctx.access === "read_write") {
		server.registerTool(
			BRAIN_TOOL_NAMES.upsert,
			{
				description: contract.upsert.description,
				inputSchema: contract.upsert.input,
			},
			async (input) =>
				run("write", async () => {
					if (
						new TextEncoder().encode(input.body).length >
						MCP_MAX_UPSERT_BODY_BYTES
					) {
						throw new BrainValidation(["body"]);
					}
					const written = await ctx.provider.upsert(input, {
						kind: "user",
						userId: ctx.userId,
					});
					return { ok: true, ...written };
				}),
		);
	}

	return server;
}
