import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { describe, expect, it, vi } from "vitest";
import { BrainConflict } from "@/lib/brain/errors";
import type { AccessStore } from "@/lib/brain/mcp-server/access";
import {
	type BrainMcpDeps,
	handleBrainMcp,
	protectedResourceMetadata,
} from "@/lib/brain/mcp-server/handler";
import type { BrainBinding } from "@/lib/brain/resolve";
import type { BrainProvider } from "@/lib/brain/types";

const binding: BrainBinding = {
	id: "b1",
	tenantId: "tenant-a",
	provider: "wiki",
	config: {
		categories: ["comercial"],
		requiredFrontmatter: [],
		search: "fts",
		mcpLimits: { readsPerMinute: 60, writesPerMinute: 10 },
	},
};

const page = {
	slug: "comercial/icp",
	title: "ICP",
	category: "comercial",
	status: "activo" as const,
	tags: ["canon:icp"],
	frontmatter: {},
	body: "…",
	revision: 3,
	updatedAt: "2026-09-24T00:00:00Z",
};

function fakeProvider(): BrainProvider {
	return {
		search: vi.fn(async () => []),
		read: vi.fn(async () => page),
		upsert: vi.fn(async () => ({ slug: "comercial/icp", revision: 4 })),
	};
}

const store: AccessStore = {
	tenantBySlug: async (slug) =>
		slug === "a"
			? { id: "tenant-a", active: true }
			: { id: "tenant-b", active: true },
	rolesOf: async (userId) =>
		userId === "admin"
			? [{ tenantId: "tenant-a", role: "tenant_admin" }]
			: [{ tenantId: "tenant-a", role: "tenant_member" }],
	brainBinding: async () => binding,
};

function deps(
	overrides: Partial<BrainMcpDeps> = {},
): BrainMcpDeps & { providerInstance: BrainProvider } {
	const providerInstance = fakeProvider();
	return {
		verify: async (token) => ({ sub: token, client_id: "claude" }),
		store,
		hit: async () => ({ allowed: true, retryAfterSeconds: 0 }),
		provider: () => providerInstance,
		publicUrl: "https://agents.test",
		issuer: "https://ref.supabase.co/auth/v1",
		providerInstance,
		...overrides,
	};
}

async function connect(token: string, d: BrainMcpDeps, slug = "a") {
	const client = new Client({ name: "test", version: "1.0.0" });
	const transport = new StreamableHTTPClientTransport(
		new URL(`https://agents.test/brain/${slug}/mcp`),
		{
			requestInit: { headers: { authorization: `Bearer ${token}` } },
			fetch: (url, init) => handleBrainMcp(new Request(url, init), slug, d),
		},
	);
	await client.connect(transport);
	return client;
}

describe("handleBrainMcp", () => {
	it("un miembro ve dos tools; un admin, tres", async () => {
		const member = await connect("ana", deps());
		expect(
			(await member.listTools()).tools.map((tool) => tool.name).sort(),
		).toEqual(["brain_read", "brain_search"]);
		const admin = await connect("admin", deps());
		expect(
			(await admin.listTools()).tools.map((tool) => tool.name).sort(),
		).toEqual(["brain_read", "brain_search", "brain_upsert"]);
	});

	it("busca y lee con el resultado del contrato", async () => {
		const client = await connect("ana", deps());
		const read = await client.callTool({
			name: "brain_read",
			arguments: { slug: "comercial/icp" },
		});
		expect(read.structuredContent).toEqual({ ok: true, page });
		const search = await client.callTool({
			name: "brain_search",
			arguments: { query: "icp" },
		});
		expect(search.structuredContent).toEqual({ ok: true, results: [] });
	});

	it("un tenantId en los argumentos no llega al proveedor", async () => {
		const d = deps();
		const client = await connect("ana", d);
		await client.callTool({
			name: "brain_search",
			arguments: { query: "icp", tenantId: "tenant-b" },
		});
		expect(d.providerInstance.search).toHaveBeenCalledWith({ query: "icp" });
	});

	it("el proveedor recibe el binding del tenant de la URL", async () => {
		const provider = vi.fn(() => fakeProvider());
		const d = deps({
			store: {
				...store,
				brainBinding: async (tenantId) => ({ ...binding, tenantId }),
			},
			provider,
		});
		const client = await connect("ana", d, "a");
		await client.callTool({
			name: "brain_search",
			arguments: { query: "icp", tenantId: "tenant-b" },
		});
		expect(provider).toHaveBeenCalled();
		for (const [called] of provider.mock.calls) {
			expect((called as BrainBinding).tenantId).toBe("tenant-a");
		}
	});

	it("un admin escribe como usuario, sin aprobación", async () => {
		const d = deps();
		const client = await connect("admin", d);
		const result = await client.callTool({
			name: "brain_upsert",
			arguments: {
				slug: "comercial/icp",
				title: "ICP",
				category: "comercial",
				status: "activo",
				tags: [],
				body: "x",
				reason: "ajuste",
				baseRevision: 3,
			},
		});
		expect(result.structuredContent).toEqual({
			ok: true,
			slug: "comercial/icp",
			revision: 4,
		});
		expect(d.providerInstance.upsert).toHaveBeenCalledWith(
			expect.objectContaining({ slug: "comercial/icp" }),
			{
				kind: "user",
				userId: "admin",
			},
		);
	});

	it("un conflicto sale como error tipado, con isError", async () => {
		const d = deps();
		vi.mocked(d.providerInstance.upsert).mockRejectedValueOnce(
			new BrainConflict("comercial/icp", 5),
		);
		const client = await connect("admin", d);
		const result = await client.callTool({
			name: "brain_upsert",
			arguments: {
				slug: "comercial/icp",
				title: "ICP",
				category: "comercial",
				status: "activo",
				tags: [],
				body: "x",
				reason: "r",
				baseRevision: 3,
			},
		});
		expect(result.isError).toBe(true);
		expect(result.structuredContent).toMatchObject({
			ok: false,
			error: "conflict",
			currentRevision: 5,
		});
	});

	it("un cuerpo de más de 100 KB se rechaza sin llegar al proveedor", async () => {
		const d = deps();
		const client = await connect("admin", d);
		const result = await client.callTool({
			name: "brain_upsert",
			arguments: {
				slug: "comercial/icp",
				title: "ICP",
				category: "comercial",
				status: "activo",
				tags: [],
				body: "x".repeat(102_401),
				reason: "r",
			},
		});
		expect(result.structuredContent).toMatchObject({
			ok: false,
			error: "validation",
			fields: ["body"],
		});
		expect(d.providerInstance.upsert).not.toHaveBeenCalled();
	});

	it("con el límite alcanzado devuelve cuánto esperar", async () => {
		const client = await connect(
			"ana",
			deps({ hit: async () => ({ allowed: false, retryAfterSeconds: 9 }) }),
		);
		const result = await client.callTool({
			name: "brain_search",
			arguments: { query: "" },
		});
		expect(result.isError).toBe(true);
		expect(result.structuredContent).toMatchObject({
			error: "rate_limited",
			retryable: true,
			retryAfterSeconds: 9,
		});
	});

	it("un error no tipado sale como internal con un id, sin detalle", async () => {
		const d = deps();
		vi.mocked(d.providerInstance.search).mockRejectedValueOnce(
			new Error("password=hunter2"),
		);
		const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
		const client = await connect("ana", d);
		const result = await client.callTool({
			name: "brain_search",
			arguments: { query: "" },
		});
		expect(result.isError).toBe(true);
		expect(JSON.stringify(result)).not.toContain("hunter2");
		expect(result.structuredContent).toMatchObject({
			ok: false,
			error: "internal",
		});
		errorLog.mockRestore();
	});

	it("sin token responde 401 con la URL de la metadata", async () => {
		const response = await handleBrainMcp(
			new Request("https://agents.test/brain/a/mcp", {
				method: "POST",
				body: "{}",
			}),
			"a",
			deps(),
		);
		expect(response.status).toBe(401);
		expect(response.headers.get("www-authenticate")).toContain(
			'resource_metadata="https://agents.test/.well-known/oauth-protected-resource/brain/a/mcp"',
		);
	});

	it("sin membresía responde 403", async () => {
		const response = await handleBrainMcp(
			new Request("https://agents.test/brain/b/mcp", {
				method: "POST",
				headers: {
					authorization: "Bearer ana",
					"content-type": "application/json",
				},
				body: "{}",
			}),
			"b",
			deps(),
		);
		expect(response.status).toBe(403);
	});

	it("un cuerpo de más de 1 MiB responde 413, con o sin content-length", async () => {
		const big = "x".repeat(1_048_577);
		const withLength = await handleBrainMcp(
			new Request("https://agents.test/brain/a/mcp", {
				method: "POST",
				headers: {
					authorization: "Bearer ana",
					"content-length": String(big.length),
				},
				body: big,
			}),
			"a",
			deps(),
		);
		expect(withLength.status).toBe(413);

		const stream = new ReadableStream({
			start(controller) {
				controller.enqueue(new TextEncoder().encode(big));
				controller.close();
			},
		});
		const withoutLength = await handleBrainMcp(
			new Request("https://agents.test/brain/a/mcp", {
				method: "POST",
				headers: { authorization: "Bearer ana" },
				body: stream,
				// @ts-expect-error: duplex es obligatorio en Node para cuerpos stream
				duplex: "half",
			}),
			"a",
			deps(),
		);
		expect(withoutLength.status).toBe(413);
	});

	it("un throw inesperado en la resolución de acceso sale como 500 sin filtrar el detalle", async () => {
		const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
		const brokenStore: AccessStore = {
			...store,
			tenantBySlug: async () => {
				throw new Error('relation "tenants" password=x');
			},
		};
		const response = await handleBrainMcp(
			new Request("https://agents.test/brain/a/mcp", {
				method: "POST",
				headers: {
					authorization: "Bearer ana",
					"content-type": "application/json",
				},
				body: "{}",
			}),
			"a",
			deps({ store: brokenStore }),
		);
		expect(response.status).toBe(500);
		const body = await response.text();
		expect(body).not.toContain("password");
		expect(JSON.parse(body)).toMatchObject({ ok: false, code: "internal" });
		errorLog.mockRestore();
	});
});

describe("protectedResourceMetadata", () => {
	it("usa la URL pública configurada y el emisor", () => {
		expect(
			protectedResourceMetadata("a", {
				publicUrl: "https://agents.test",
				issuer: "https://ref.supabase.co/auth/v1",
			}),
		).toEqual({
			resource: "https://agents.test/brain/a/mcp",
			authorization_servers: ["https://ref.supabase.co/auth/v1"],
			bearer_methods_supported: ["header"],
		});
	});
});
