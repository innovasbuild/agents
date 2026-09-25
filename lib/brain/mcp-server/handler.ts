// Request al endpoint del brain (spec etapa 11 §5.1, §5.2). Stateless: un
// servidor y un transporte por request, con respuesta JSON.
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { createUnauthorizedResponse } from "eve/channels/auth";
import type { BrainBinding } from "../resolve.ts";
import type { BrainProvider } from "../types.ts";
import {
	type AccessStore,
	type ClaimsVerifier,
	resolveMcpAccess,
} from "./access.ts";
import { createRateLimiter, type HitFn } from "./rate-limit.ts";
import { buildBrainMcpServer, MCP_MAX_REQUEST_BYTES } from "./server.ts";

export interface BrainMcpDeps {
	verify: ClaimsVerifier;
	store: AccessStore;
	hit: HitFn;
	provider: (binding: BrainBinding) => BrainProvider;
	publicUrl: string;
	issuer: string;
}

function resourceUrl(publicUrl: string, slug: string): string {
	return `${publicUrl}/brain/${slug}/mcp`;
}

function metadataUrl(publicUrl: string, slug: string): string {
	return `${publicUrl}/.well-known/oauth-protected-resource/brain/${slug}/mcp`;
}

export function protectedResourceMetadata(
	slug: string,
	deps: Pick<BrainMcpDeps, "publicUrl" | "issuer">,
) {
	return {
		resource: resourceUrl(deps.publicUrl, slug),
		authorization_servers: [deps.issuer],
		bearer_methods_supported: ["header"],
	};
}

function tooLarge(): Response {
	return Response.json(
		{ ok: false, code: "payload_too_large", error: "El pedido supera 1 MiB." },
		{ status: 413 },
	);
}

async function readLimited(request: Request): Promise<string | null> {
	if (!request.body) return "";
	const reader = request.body.getReader();
	const chunks: Uint8Array[] = [];
	let total = 0;
	for (;;) {
		const { done, value } = await reader.read();
		if (done) break;
		total += value.byteLength;
		if (total > MCP_MAX_REQUEST_BYTES) {
			await reader.cancel();
			return null;
		}
		chunks.push(value);
	}
	return new TextDecoder().decode(Buffer.concat(chunks));
}

async function handleBrainMcpInner(
	request: Request,
	slug: string,
	deps: BrainMcpDeps,
): Promise<Response> {
	const declared = Number(request.headers.get("content-length") ?? "0");
	if (declared > MCP_MAX_REQUEST_BYTES) return tooLarge();

	const access = await resolveMcpAccess(
		{ authorization: request.headers.get("authorization"), slug },
		{ verify: deps.verify, store: deps.store },
	);
	if (!access.ok) {
		if (access.status === 401) {
			return createUnauthorizedResponse({
				code: access.code,
				message: access.message,
				challenges: [
					{
						scheme: "Bearer",
						parameters: {
							resource_metadata: metadataUrl(deps.publicUrl, slug),
							...(access.code === "invalid_token"
								? { error: "invalid_token" }
								: {}),
						},
					},
				],
			});
		}
		return Response.json(
			{ ok: false, code: access.code, error: access.message },
			{ status: access.status },
		);
	}

	const text = await readLimited(request);
	if (text === null) return tooLarge();
	let parsedBody: unknown;
	try {
		parsedBody = JSON.parse(text);
	} catch {
		return Response.json(
			{ ok: false, code: "invalid_json", error: "El cuerpo no es JSON." },
			{ status: 400 },
		);
	}

	const server = buildBrainMcpServer({
		userId: access.userId,
		access: access.access,
		categories: access.binding.config.categories,
		provider: deps.provider(access.binding),
		limiter: createRateLimiter({
			tenantId: access.tenantId,
			userId: access.userId,
			limits: access.binding.config.mcpLimits,
			hit: deps.hit,
		}),
	});
	const transport = new WebStandardStreamableHTTPServerTransport({
		sessionIdGenerator: undefined,
		enableJsonResponse: true,
	});
	await server.connect(transport);
	try {
		return await transport.handleRequest(request, { parsedBody });
	} finally {
		await server.close();
	}
}

export async function handleBrainMcp(
	request: Request,
	slug: string,
	deps: BrainMcpDeps,
): Promise<Response> {
	try {
		return await handleBrainMcpInner(request, slug, deps);
	} catch (error) {
		const errorId = crypto.randomUUID();
		console.error(`brain mcp: error interno ${errorId}`, error);
		return Response.json(
			{ ok: false, code: "internal", error: `Error interno (${errorId}).` },
			{ status: 500 },
		);
	}
}
