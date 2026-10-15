import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { createUnauthorizedResponse } from "eve/channels/auth";
import { describe, expect, it, vi } from "vitest";
import { BrainConflict } from "@/lib/brain/core/errors";
import type { AccessStore } from "@/lib/brain/core/mcp-server/access";
import {
	type BrainMcpDeps,
	handleBrainMcp,
	protectedResourceMetadata,
} from "@/lib/brain/core/mcp-server/handler";
import type { BrainBinding } from "@/lib/brain/core/resolve";
import { createWikiRules } from "@/lib/brain/core/rules-source";
import type { SkillOverviewRow } from "@/lib/brain/core/skills/store";
import type { BrainProvider } from "@/lib/brain/core/types";

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
		list: async () => [],
		history: async () => null,
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
	platformOwnerTenantId: async () => null,
	allowsLogin: async () => true,
};

function deps(
	overrides: Partial<BrainMcpDeps> = {},
): BrainMcpDeps & { providerInstance: BrainProvider } {
	const providerInstance = fakeProvider();
	return {
		verify: async (token) => ({ sub: token, client_id: "claude" }),
		store,
		rules: { load: async () => [] },
		hit: async () => ({ allowed: true, retryAfterSeconds: 0 }),
		provider: () => providerInstance,
		usesCanon: async () => false,
		publicUrl: "https://agents.test",
		issuer: "https://ref.supabase.co/auth/v1",
		unauthorized: createUnauthorizedResponse,
		skills: {
			overview: async () => [],
			blob: async () => null,
			record: async () => {},
			issue: vi.fn(),
		},
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
	it("todos ven las tools del brain: el permiso se aplica al llamarlas", async () => {
		const member = await connect("ana", deps());
		expect(
			(await member.listTools()).tools.map((tool) => tool.name).sort(),
		).toEqual(["brain_read", "brain_rules", "brain_search", "brain_upsert"]);
		const admin = await connect("admin", deps());
		expect(
			(await admin.listTools()).tools.map((tool) => tool.name).sort(),
		).toEqual(["brain_read", "brain_rules", "brain_search", "brain_upsert"]);
	});

	it("las descripciones nombran el canon solo si la empresa lo usa", async () => {
		const asked: string[] = [];
		const neutral = await connect(
			"ana",
			deps({
				usesCanon: async (tenantId) => {
					asked.push(tenantId);
					return false;
				},
			}),
		);
		const neutralTools = (await neutral.listTools()).tools;
		expect(asked).toContain("tenant-a");
		expect(
			neutralTools.find((t) => t.name === "brain_upsert")?.description,
		).not.toContain("Tags de canon");
		const withCanon = await connect(
			"ana",
			deps({ usesCanon: async () => true }),
		);
		expect(
			(await withCanon.listTools()).tools.find((t) => t.name === "brain_upsert")
				?.description,
		).toContain("Tags de canon");
	});

	it("busca y lee con el resultado del contrato", async () => {
		const client = await connect("ana", deps());
		const read = await client.callTool({
			name: "brain_read",
			arguments: { slug: "comercial/icp" },
		});
		// Sin reglas en el brain, brain_read trae la cascada vacía (spec etapa 26 §4.3).
		expect(read.structuredContent).toEqual({
			ok: true,
			page,
			rules: { revision: "", chain: [] },
		});
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
		const [called] = vi.mocked(d.providerInstance.search).mock.calls[0];
		expect(called).toMatchObject({ query: "icp" });
		expect(called).not.toHaveProperty("tenantId");
	});

	it("el proveedor recibe el binding del tenant de la URL", async () => {
		const provider = vi.fn((_binding: BrainBinding) => fakeProvider());
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
			expect(called.tenantId).toBe("tenant-a");
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

	const upsertArgs = {
		slug: "comercial/icp",
		title: "ICP",
		category: "comercial",
		status: "activo",
		tags: [],
		body: "x",
		reason: "ajuste",
		baseRevision: 3,
	};

	it("un miembro que no es editor recibe forbidden al escribir, sin llegar al proveedor", async () => {
		const d = deps();
		const client = await connect("ana", d);
		const result = await client.callTool({
			name: "brain_upsert",
			arguments: upsertArgs,
		});
		expect(result.isError).toBe(true);
		expect(result.structuredContent).toMatchObject({
			ok: false,
			error: "forbidden",
		});
		expect(d.providerInstance.upsert).not.toHaveBeenCalled();
	});

	it("un miembro con una regla de editor sobre la carpeta escribe como usuario", async () => {
		const d = deps({
			rules: {
				load: async () => [
					{
						path: "comercial",
						principal: "user",
						userId: "ana",
						level: "editor",
					},
				],
			},
		});
		const client = await connect("ana", d);
		const result = await client.callTool({
			name: "brain_upsert",
			arguments: upsertArgs,
		});
		expect(result.structuredContent).toMatchObject({ ok: true, revision: 4 });
		expect(d.providerInstance.upsert).toHaveBeenCalledWith(
			expect.objectContaining({ slug: "comercial/icp" }),
			{ kind: "user", userId: "ana" },
		);
	});

	it("una página oculta para el miembro responde not_found como si no existiera", async () => {
		const d = deps({
			rules: {
				load: async () => [
					{
						path: "comercial",
						principal: "members",
						userId: null,
						level: "ninguno",
					},
				],
			},
		});
		const client = await connect("ana", d);
		const result = await client.callTool({
			name: "brain_read",
			arguments: { slug: "comercial/icp" },
		});
		expect(result.isError).toBe(true);
		expect(result.structuredContent).toMatchObject({
			ok: false,
			error: "not_found",
			suggestions: [],
		});
		expect(d.providerInstance.read).not.toHaveBeenCalled();
	});

	it("un admin no consulta las reglas y su proveedor no se envuelve", async () => {
		const load = vi.fn(async () => []);
		const d = deps({ rules: { load } });
		const client = await connect("admin", d);
		await client.callTool({
			name: "brain_search",
			arguments: { query: "icp" },
		});
		expect(load).not.toHaveBeenCalled();
		expect(d.providerInstance.search).toHaveBeenCalledWith({ query: "icp" });
	});

	it("si las reglas no se pueden cargar, falla cerrado: 500 y nada llega al proveedor", async () => {
		const d = deps({
			rules: {
				load: async () => {
					throw new Error("base caída");
				},
			},
		});
		const error = vi.spyOn(console, "error").mockImplementation(() => {});
		const response = await handleBrainMcp(
			new Request("https://agents.test/brain/a/mcp", {
				method: "POST",
				headers: {
					authorization: "Bearer ana",
					"content-type": "application/json",
					accept: "application/json, text/event-stream",
				},
				body: JSON.stringify({
					jsonrpc: "2.0",
					id: 1,
					method: "tools/call",
					params: { name: "brain_search", arguments: { query: "icp" } },
				}),
			}),
			"a",
			d,
		);
		expect(response.status).toBe(500);
		expect(d.providerInstance.search).not.toHaveBeenCalled();
		error.mockRestore();
	});

	describe("skills", () => {
		const skillBinding: BrainBinding = {
			...binding,
			config: { ...binding.config, categories: ["comercial", "skill"] },
		} as BrainBinding;
		const skillDeps = () =>
			deps({ store: { ...store, brainBinding: async () => skillBinding } });

		it("ni un administrador lee una skill por MCP", async () => {
			const d = skillDeps();
			const admin = await connect("admin", d);
			const result = await admin.callTool({
				name: "brain_read",
				arguments: { slug: "skills/facturacion" },
			});
			expect(result.isError).toBe(true);
			expect(result.structuredContent).toMatchObject({ error: "not_found" });
			expect(d.providerInstance.read).not.toHaveBeenCalled();
		});

		it("brain_upsert no anuncia la categoría skill", async () => {
			const admin = await connect("admin", skillDeps());
			const upsert = (await admin.listTools()).tools.find(
				(tool) => tool.name === "brain_upsert",
			);
			expect(JSON.stringify(upsert?.inputSchema)).toContain('"comercial"');
			expect(JSON.stringify(upsert?.inputSchema)).not.toContain('"skill"');
		});
	});
});

describe("brain por MCP en el dominio de una empresa", () => {
	const OKEEFE = "https://ai.okeefe.com.ar";

	it("la metadata anuncia /brain/mcp, sin slug", () => {
		expect(
			protectedResourceMetadata("okeefe", {
				publicUrl: OKEEFE,
				tenantHost: true,
				issuer: "https://ref.supabase.co/auth/v1",
			}),
		).toEqual({
			resource: `${OKEEFE}/brain/mcp`,
			authorization_servers: ["https://ref.supabase.co/auth/v1"],
			bearer_methods_supported: ["header"],
		});
	});

	it("el 401 apunta a la metadata de /brain/mcp", async () => {
		const response = await handleBrainMcp(
			new Request(`${OKEEFE}/brain/okeefe/mcp`, {
				method: "POST",
				body: "{}",
			}),
			"a",
			deps({ publicUrl: OKEEFE, tenantHost: true }),
		);
		expect(response.status).toBe(401);
		expect(response.headers.get("www-authenticate")).toContain(
			`resource_metadata="${OKEEFE}/.well-known/oauth-protected-resource/brain/mcp"`,
		);
	});

	it("un slug que no es el del host responde 404 como si no existiera", async () => {
		const response = await handleBrainMcp(
			new Request(`${OKEEFE}/brain/otra/mcp`, {
				method: "POST",
				headers: { authorization: "Bearer ana" },
				body: "{}",
			}),
			"b",
			deps({ publicUrl: OKEEFE, tenantHost: true, hostServes: () => false }),
		);
		expect(response.status).toBe(404);
		expect(await response.json()).toEqual({
			ok: false,
			code: "tenant_not_found",
			error: "No existe ese cliente.",
		});
	});

	it("sin hostServes (host raíz) no valida nada", async () => {
		const response = await handleBrainMcp(
			new Request("https://agents.test/brain/a/mcp", {
				method: "POST",
				body: "{}",
			}),
			"a",
			deps(),
		);
		expect(response.status).toBe(401);
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

function publishedRow(slug: string): SkillOverviewRow {
	return {
		pageId: `page-${slug}`,
		slug,
		revision: 9,
		draftFilesDigest: "draft",
		current: {
			action: "publicar",
			version: 2,
			pageRevision: 5,
			filesDigest: "fd",
			title: "T",
			description: "Describe la skill.",
			body: "# Pasos",
			frontmatter: {},
			manifest: [{ path: "a.md", sha256: "sha-a", size: 4 }],
			digest: "dg",
			publishedAt: "2026-10-13T12:00:00Z",
		},
	};
}

const BRAIN_TOOLS = [
	"brain_read",
	"brain_rules",
	"brain_search",
	"brain_upsert",
];

describe("handleBrainMcp · skills", () => {
	it("sin skills publicadas el servidor queda como antes", async () => {
		const client = await connect("ana", deps());
		expect((await client.listTools()).tools.map((t) => t.name).sort()).toEqual(
			BRAIN_TOOLS,
		);
	});

	it("un miembro carga una skill que puede leer; queda registrado con tenant y persona", async () => {
		const record = vi.fn(async () => {});
		const blob = vi.fn(async () => new TextEncoder().encode("hola"));
		const client = await connect(
			"ana",
			deps({
				skills: {
					overview: async () => [publishedRow("skills/ventas/reporte")],
					blob,
					record,
					issue: vi.fn(),
				},
			}),
		);
		const loaded = await client.callTool({
			name: "skill_load",
			arguments: { name: "reporte" },
		});
		expect(loaded.structuredContent).toMatchObject({ ok: true, version: 2 });
		expect(record).toHaveBeenCalledWith({
			tenantId: "tenant-a",
			userId: "ana",
			slug: "skills/ventas/reporte",
			name: "reporte",
			version: 2,
			digest: "dg",
		});
		const file = await client.callTool({
			name: "skill_file",
			arguments: { name: "reporte", path: "a.md" },
		});
		expect(file.structuredContent).toMatchObject({ ok: true, content: "hola" });
		expect(blob).toHaveBeenCalledWith("tenant-a", "sha-a");
	});

	it("skill_package pide el link con el tenant, la persona y la copia publicada", async () => {
		const issue = vi.fn(async () => ({
			name: "reporte",
			version: 2,
			filename: "reporte-v2.zip",
			url: "https://storage.test/firmado",
			expiresIn: 600,
		}));
		const client = await connect(
			"ana",
			deps({
				skills: {
					overview: async () => [publishedRow("skills/ventas/reporte")],
					blob: async () => null,
					record: async () => {},
					issue,
				},
			}),
		);
		const result = await client.callTool({
			name: "skill_package",
			arguments: { name: "reporte" },
		});
		expect(result.structuredContent).toMatchObject({
			ok: true,
			url: "https://storage.test/firmado",
		});
		expect(issue).toHaveBeenCalledWith({
			tenantId: "tenant-a",
			userId: "ana",
			slug: "skills/ventas/reporte",
			snapshot: expect.objectContaining({ version: 2, digest: "dg" }),
		});
	});

	it("las reglas del brain deciden qué skills ve un miembro; un administrador ve todas", async () => {
		const d = () =>
			deps({
				rules: {
					load: async () => [
						{
							path: "skills/rrhh",
							principal: "members" as const,
							userId: null,
							level: "ninguno" as const,
						},
					],
				},
				skills: {
					overview: async () => [
						publishedRow("skills/rrhh/sueldos"),
						publishedRow("skills/ventas/reporte"),
					],
					blob: async () => null,
					record: async () => {},
					issue: vi.fn(),
				},
			});
		const member = await connect("ana", d());
		const memberList = await member.callTool({
			name: "skill_list",
			arguments: {},
		});
		expect(
			(
				memberList.structuredContent as { skills: { name: string }[] }
			).skills.map((s) => s.name),
		).toEqual(["reporte"]);
		const hidden = await member.callTool({
			name: "skill_load",
			arguments: { name: "sueldos" },
		});
		expect(hidden.isError).toBe(true);

		const admin = await connect("admin", d());
		const adminList = await admin.callTool({
			name: "skill_list",
			arguments: {},
		});
		expect(
			(
				adminList.structuredContent as { skills: { name: string }[] }
			).skills.map((s) => s.name),
		).toEqual(["reporte", "sueldos"]);
	});

	it("brain_read sobre skills/ sigue sin existir aunque la skill se pueda cargar", async () => {
		const client = await connect(
			"ana",
			deps({
				skills: {
					overview: async () => [publishedRow("skills/ventas/reporte")],
					blob: async () => null,
					record: async () => {},
					issue: vi.fn(),
				},
			}),
		);
		const read = await client.callTool({
			name: "brain_read",
			arguments: { slug: "skills/ventas/reporte" },
		});
		expect(read.isError).toBe(true);
		expect(read.structuredContent).toMatchObject({ error: "not_found" });
	});

	it("si la lectura de skills falla, las tools del brain siguen andando", async () => {
		const spy = vi.spyOn(console, "error").mockImplementation(() => {});
		const client = await connect(
			"ana",
			deps({
				skills: {
					overview: async () => {
						throw new Error("rpc caída");
					},
					blob: async () => null,
					record: async () => {},
					issue: vi.fn(),
				},
			}),
		);
		expect((await client.listTools()).tools.map((t) => t.name).sort()).toEqual(
			BRAIN_TOOLS,
		);
		const read = await client.callTool({
			name: "brain_read",
			arguments: { slug: "comercial/icp" },
		});
		expect(read.structuredContent).toMatchObject({ ok: true });
		spy.mockRestore();
	});

	it("con un brain externo no hay tools de skills ni se consulta el overview", async () => {
		const overview = vi.fn(async () => [publishedRow("skills/a")]);
		const client = await connect(
			"ana",
			deps({
				store: {
					...store,
					brainBinding: async () => ({ ...binding, provider: "mcp" }) as never,
				},
				skills: {
					overview,
					blob: async () => null,
					record: async () => {},
					issue: vi.fn(),
				},
			}),
		);
		expect((await client.listTools()).tools.map((t) => t.name).sort()).toEqual(
			BRAIN_TOOLS,
		);
		expect(overview).not.toHaveBeenCalled();
	});
});

describe("handleBrainMcp · reglas", () => {
	const rulePages = [
		{
			slug: "00-reglas",
			status: "activo" as const,
			revision: 2,
			body: "Escribí en tercera persona.",
		},
		{
			slug: "talento/personal/00-reglas",
			status: "activo" as const,
			revision: 5,
			body: "Cada ficha lleva reporta_a.",
		},
	];
	const folders = [
		{ path: "talento", description: "Personas | equipos" },
		{ path: "talento/personal", description: "" },
		{ path: "direccion", description: "Presupuesto" },
		{ path: "skills", description: "" },
	];
	const brainRules = () =>
		createWikiRules({
			tenantId: "tenant-a",
			store: {
				listRulePages: async () => rulePages,
				listFolders: async () => folders,
			},
		});
	const newPage = {
		slug: "talento/personal/leo",
		title: "Leo",
		category: "comercial",
		status: "activo",
		tags: [],
		body: "Ficha",
		reason: "alta",
	};

	it("brain_upsert sin rulesRevision devuelve rules_required con la raíz, no escribe y cuenta como lectura", async () => {
		const hit = vi.fn(async () => ({ allowed: true, retryAfterSeconds: 0 }));
		const d = deps({ brainRules, hit });
		const client = await connect("admin", d);
		const result = await client.callTool({
			name: "brain_upsert",
			arguments: newPage,
		});
		expect(result.isError).toBe(true);
		expect(result.structuredContent).toMatchObject({
			ok: false,
			error: "rules_required",
			rules: { chain: [{ path: "" }, { path: "talento/personal" }] },
		});
		expect(d.providerInstance.upsert).not.toHaveBeenCalled();
		const kinds = hit.mock.calls.map(
			(call) => (call as unknown as [{ kind: string }])[0].kind,
		);
		expect(kinds).toContain("read");
		expect(kinds).not.toContain("write");
	});

	it("el reintento con el rulesRevision devuelto entra, sin pasarle rulesRevision al proveedor", async () => {
		const d = deps({ brainRules });
		const client = await connect("admin", d);
		const first = await client.callTool({
			name: "brain_upsert",
			arguments: newPage,
		});
		const revision = (
			first.structuredContent as { rules: { revision: string } }
		).rules.revision;
		const second = await client.callTool({
			name: "brain_upsert",
			arguments: { ...newPage, rulesRevision: revision },
		});
		expect(second.structuredContent).toMatchObject({ ok: true });
		const [written] = vi.mocked(d.providerInstance.upsert).mock.calls[0];
		expect(written).toMatchObject({ slug: "talento/personal/leo" });
		expect(written).not.toHaveProperty("rulesRevision");
	});

	it("un miembro que no ve la carpeta recibe forbidden, nunca las reglas", async () => {
		const d = deps({
			brainRules,
			rules: {
				load: async () => [
					{
						path: "talento",
						principal: "members",
						userId: null,
						level: "ninguno",
					},
				],
			},
		});
		const client = await connect("ana", d);
		const result = await client.callTool({
			name: "brain_upsert",
			arguments: newPage,
		});
		expect(result.structuredContent).toMatchObject({
			ok: false,
			error: "forbidden",
		});
		expect(JSON.stringify(result)).not.toContain("reporta_a");
		const update = await client.callTool({
			name: "brain_upsert",
			arguments: { ...newPage, baseRevision: 1 },
		});
		expect(update.structuredContent).toMatchObject({
			ok: false,
			error: "not_found",
		});
		expect(JSON.stringify(update)).not.toContain("reporta_a");
		const cascade = await client.callTool({
			name: "brain_rules",
			arguments: { path: "talento/personal/leo" },
		});
		expect(cascade.structuredContent).toMatchObject({
			ok: false,
			error: "not_found",
		});
		expect(JSON.stringify(cascade)).not.toContain("reporta_a");
	});

	it("brain_read trae las reglas de la carpeta sin la raíz", async () => {
		const client = await connect("admin", deps({ brainRules }));
		const result = await client.callTool({
			name: "brain_read",
			arguments: { slug: "talento/personal/leo" },
		});
		const rules = (
			result.structuredContent as {
				rules: { revision: string; chain: Array<{ path: string }> };
			}
		).rules;
		expect(rules.chain.map((e) => e.path)).toEqual(["talento/personal"]);
		expect(rules.revision).toMatch(/^[0-9a-f]{16}$/);
	});

	it("una 00-reglas se lee sin traerse a sí misma y se escribe con la revisión de arriba", async () => {
		const d = deps({ brainRules });
		const client = await connect("admin", d);
		const read = await client.callTool({
			name: "brain_read",
			arguments: { slug: "talento/personal/00-reglas" },
		});
		expect(
			(read.structuredContent as { rules: { chain: unknown[] } }).rules.chain,
		).toEqual([]);
		const write = await client.callTool({
			name: "brain_upsert",
			arguments: {
				...newPage,
				slug: "talento/personal/00-reglas",
				baseRevision: 5,
			},
		});
		expect(write.structuredContent).toMatchObject({
			error: "rules_required",
			rules: { chain: [{ path: "" }] },
		});
	});

	it("brain_rules de una ruta que no existe devuelve la cascada completa", async () => {
		const client = await connect("ana", deps({ brainRules }));
		const result = await client.callTool({
			name: "brain_rules",
			arguments: { path: "talento/personal/nueva" },
		});
		expect(result.structuredContent).toMatchObject({
			ok: true,
			rules: { chain: [{ path: "" }, { path: "talento/personal" }] },
		});
	});

	it("las instrucciones traen las de la raíz y solo las carpetas que la persona ve", async () => {
		const client = await connect(
			"ana",
			deps({
				brainRules,
				rules: {
					load: async () => [
						{
							path: "direccion",
							principal: "members",
							userId: null,
							level: "ninguno",
						},
					],
				},
			}),
		);
		const instructions = client.getInstructions() ?? "";
		expect(instructions).toContain("Escribí en tercera persona.");
		expect(instructions).toContain("| talento | Personas \\| equipos |");
		expect(instructions).toContain("brain_rules");
		expect(instructions).not.toContain("direccion");
		expect(instructions).not.toContain("| skills");
		expect(instructions).not.toContain("| talento/personal");
	});

	it("quien no ve nada del brain no recibe las instrucciones de la raíz", async () => {
		const client = await connect(
			"ana",
			deps({
				brainRules,
				rules: {
					load: async () => [
						{ path: "", principal: "members", userId: null, level: "ninguno" },
					],
				},
			}),
		);
		const instructions = client.getInstructions() ?? "";
		expect(instructions).not.toContain("Escribí en tercera persona.");
		expect(instructions).not.toContain("| talento");
	});

	it("quien solo ve una subcarpeta recibe las instrucciones de la raíz que la gobiernan", async () => {
		const client = await connect(
			"ana",
			deps({
				brainRules,
				rules: {
					load: async () => [
						{ path: "", principal: "members", userId: null, level: "ninguno" },
						{
							path: "talento/personal",
							principal: "user",
							userId: "ana",
							level: "editor",
						},
					],
				},
			}),
		);
		const instructions = client.getInstructions() ?? "";
		expect(instructions).toContain("Escribí en tercera persona.");
		// La tabla es de primer nivel: talento no lo ve.
		expect(instructions).not.toContain("| talento");
	});

	it("un administrador recibe las instrucciones aunque los miembros no vean la raíz", async () => {
		const client = await connect(
			"admin",
			deps({
				brainRules,
				rules: {
					load: async () => [
						{ path: "", principal: "members", userId: null, level: "ninguno" },
					],
				},
			}),
		);
		const instructions = client.getInstructions() ?? "";
		expect(instructions).toContain("Escribí en tercera persona.");
		expect(instructions).toContain("| direccion | Presupuesto |");
	});

	it("si no se pueden leer las reglas, el servidor arranca sin el bloque", async () => {
		const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
		const client = await connect(
			"ana",
			deps({
				brainRules: () =>
					createWikiRules({
						tenantId: "tenant-a",
						store: {
							listRulePages: async () => {
								throw new Error("caída");
							},
							listFolders: async () => folders,
						},
					}),
			}),
		);
		expect(client.getInstructions()).toBeUndefined();
		expect((await client.listTools()).tools.map((t) => t.name).sort()).toEqual(
			BRAIN_TOOLS,
		);
		errorLog.mockRestore();
	});

	it("un brain externo por MCP responde la cascada vacía y no tiene instrucciones del brain", async () => {
		const client = await connect(
			"ana",
			deps({
				store: {
					...store,
					brainBinding: async () => ({ ...binding, provider: "mcp" }) as never,
				},
			}),
		);
		const result = await client.callTool({
			name: "brain_rules",
			arguments: { path: "talento/x" },
		});
		expect(result.structuredContent).toMatchObject({
			ok: true,
			rules: { revision: "", chain: [] },
		});
		expect(client.getInstructions()).toBeUndefined();
	});
});
