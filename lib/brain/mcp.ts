// Proveedor mcp del brain (spec etapa 11 §7.3): habla nuestro contrato con un
// servidor MCP remoto. El mapeo de la config solo renombra tools (D10).
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { z } from "zod";
import { brainResultSchemas } from "./contract.ts";
import {
	BrainConflict,
	type BrainError,
	BrainForbidden,
	BrainNotFound,
	BrainProviderError,
	BrainValidation,
} from "./errors.ts";
import type { McpBrainConfig } from "./mcp-config.ts";
import type { BrainProvider } from "./types.ts";

export interface McpBrainProviderOptions {
	config: McpBrainConfig;
	transport: () => Promise<Transport>;
}

const remoteError = z.object({
	error: z.string(),
	message: z.string().optional(),
	suggestions: z.array(z.string()).optional(),
	currentRevision: z.number().int().nullable().optional(),
	fields: z.array(z.string()).optional(),
});

function toBrainError(slug: string, value: unknown): BrainError {
	const parsed = remoteError.safeParse(value);
	if (!parsed.success)
		return new BrainProviderError(
			"el brain remoto devolvió un error sin forma conocida",
		);
	const error = parsed.data;
	switch (error.error) {
		case "not_found":
			return new BrainNotFound(slug, error.suggestions ?? []);
		case "conflict":
			return new BrainConflict(slug, error.currentRevision ?? null);
		case "validation":
			return new BrainValidation(error.fields ?? []);
		case "forbidden":
			return new BrainForbidden(
				error.message ?? "el brain remoto rechazó la operación",
			);
		default:
			return new BrainProviderError(
				`el brain remoto devolvió el error ${error.error.slice(0, 60)}`,
			);
	}
}

export function streamableTransport(
	url: string,
	getToken: () => Promise<string>,
): () => Promise<Transport> {
	return async () =>
		new StreamableHTTPClientTransport(new URL(url), {
			requestInit: { headers: { authorization: `Bearer ${await getToken()}` } },
		});
}

export function createMcpBrainProvider(
	options: McpBrainProviderOptions,
): BrainProvider {
	const { config } = options;

	async function call<T>(
		tool: string,
		args: Record<string, unknown>,
		schema: z.ZodType<T>,
		slug: string,
	): Promise<T> {
		const client = new Client({
			name: "innovas-agents-brain",
			version: "1.0.0",
		});
		let result: Awaited<ReturnType<Client["callTool"]>>;
		try {
			await client.connect(await options.transport(), {
				timeout: config.timeoutMs,
			});
			result = await client.callTool(
				{ name: tool, arguments: args },
				undefined,
				{
					timeout: config.timeoutMs,
				},
			);
		} catch (error) {
			// El texto del remoto o del SDK no le llega a quien llama: queda en el log.
			console.error("brain mcp remoto:", error);
			throw new BrainProviderError("el brain remoto no respondió");
		} finally {
			await client.close().catch(() => {});
		}

		if (result.isError) throw toBrainError(slug, result.structuredContent);

		const parsed = schema.safeParse(result.structuredContent);
		if (!parsed.success) {
			const field = parsed.error.issues[0]?.path.join(".") || "respuesta";
			throw new BrainProviderError(
				`el brain remoto devolvió una respuesta inválida en ${field}`,
			);
		}
		return parsed.data;
	}

	return {
		async search(input) {
			const out = await call(
				config.tools.search,
				{ ...input },
				brainResultSchemas.search,
				"",
			);
			return out.results;
		},
		async read(slug) {
			const out = await call(
				config.tools.read,
				{ slug },
				brainResultSchemas.read,
				slug,
			);
			return out.page;
		},
		async upsert(write) {
			const out = await call(
				config.tools.upsert,
				{ ...write },
				brainResultSchemas.upsert,
				write.slug,
			);
			return { slug: out.slug, revision: out.revision };
		},
	};
}
