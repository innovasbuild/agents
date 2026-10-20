// Server MCP del brain en aislamiento: sin HTTP, un par de transportes en
// memoria. handler.test.ts ya cubre el camino completo por HTTP; acá se
// prueba server.ts solo (spec etapa 11 §5.3).
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it, vi } from "vitest";
import {
	BrainError,
	BrainNotFound,
	BrainValidation,
} from "@/lib/brain/core/errors";
import type { RateLimiter } from "@/lib/brain/core/mcp-server/rate-limit";
import {
	buildBrainMcpServer,
	MCP_MAX_UPSERT_BODY_BYTES,
} from "@/lib/brain/core/mcp-server/server";
import { createWikiRules, EMPTY_RULES } from "@/lib/brain/core/rules-source";
import type { SkillCatalog } from "@/lib/brain/core/skills/catalog";
import type { DraftChange, SkillDrafts } from "@/lib/brain/core/skills/draft";
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
		listMeta: async () => [],
		listLinks: async () => [],
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

	it("con fuente de reglas suma brain_rules y brain_read trae las reglas sin la raíz", async () => {
		const rules = createWikiRules({
			tenantId: "t",
			store: {
				listRulePages: async () => [
					{ slug: "00-reglas", status: "activo", revision: 1, body: "raíz" },
					{
						slug: "comercial/00-reglas",
						status: "activo",
						revision: 2,
						body: "comercial",
					},
				],
				listFolders: async () => [],
			},
		});
		const server = buildBrainMcpServer({
			userId: "ana",
			categories: ["comercial"],
			canon: false,
			provider: fakeProvider(),
			limiter: fakeLimiter(),
			rules,
		});
		const client = await connect(server);
		expect((await client.listTools()).tools.map((t) => t.name).sort()).toEqual([
			"brain_read",
			"brain_rules",
			"brain_search",
			"brain_upsert",
		]);
		const read = await client.callTool({
			name: "brain_read",
			arguments: { slug: "comercial/icp" },
		});
		expect(read.structuredContent).toMatchObject({
			ok: true,
			page,
			rules: { chain: [{ path: "comercial", body: "comercial" }] },
		});
		const cascade = await client.callTool({
			name: "brain_rules",
			arguments: { path: "comercial/nueva" },
		});
		expect(cascade.structuredContent).toMatchObject({
			ok: true,
			rules: {
				chain: [{ path: "" }, { path: "comercial" }],
				fields: [],
				template: null,
			},
		});
	});

	it("un rules_required cuenta como lectura y no llega al proveedor", async () => {
		const provider = fakeProvider();
		const limiter = fakeLimiter();
		const rules = createWikiRules({
			tenantId: "t",
			store: {
				listRulePages: async () => [
					{
						slug: "comercial/00-reglas",
						status: "activo",
						revision: 2,
						body: "b",
					},
				],
				listFolders: async () => [],
			},
		});
		const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
		const server = buildBrainMcpServer({
			userId: "admin",
			categories: ["comercial"],
			canon: false,
			provider,
			limiter,
			rules,
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
				body: "x",
				reason: "r",
			},
		});
		// La escritura no ocurrió: para el protocolo es un error y el modelo
		// reintenta. Cuenta como lectura, nunca como escritura, y no se loguea
		// (plan 26.2a, decisión 5).
		expect(result.isError).toBe(true);
		expect(result.structuredContent).toMatchObject({
			ok: false,
			error: "rules_required",
		});
		expect(limiter.check.mock.calls).toEqual([["read"]]);
		expect(provider.upsert).not.toHaveBeenCalled();
		expect(errorLog).not.toHaveBeenCalled();
		errorLog.mockRestore();
	});

	it("el reintento con el rulesRevision vigente cuenta como escritura", async () => {
		const provider = fakeProvider();
		const limiter = fakeLimiter();
		const rules = createWikiRules({
			tenantId: "t",
			store: {
				listRulePages: async () => [
					{
						slug: "comercial/00-reglas",
						status: "activo",
						revision: 2,
						body: "b",
					},
				],
				listFolders: async () => [],
			},
		});
		const server = buildBrainMcpServer({
			userId: "admin",
			categories: ["comercial"],
			canon: false,
			provider,
			limiter,
			rules,
		});
		const client = await connect(server);
		const { revision } = await rules.cascade("comercial/icp");
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
				rulesRevision: revision,
			},
		});
		expect(result.structuredContent).toMatchObject({ ok: true });
		expect(limiter.check.mock.calls).toEqual([["write"]]);
	});

	it("las instrucciones suman el bloque del brain a las de skills", async () => {
		const server = buildBrainMcpServer({
			userId: "ana",
			categories: ["comercial"],
			canon: false,
			provider: fakeProvider(),
			limiter: fakeLimiter(),
			rules: EMPTY_RULES,
			brainInstructions: "# Instrucciones del brain\n\nTercera persona.",
		});
		const client = await connect(server);
		expect(client.getInstructions()).toBe(
			"# Instrucciones del brain\n\nTercera persona.",
		);
		const withSkills = await connect(
			buildBrainMcpServer({
				userId: "ana",
				categories: ["comercial"],
				canon: false,
				provider: fakeProvider(),
				limiter: fakeLimiter(),
				skills: fakeCatalog(),
				rules: EMPTY_RULES,
				brainInstructions: "# Instrucciones del brain\n\nTercera persona.",
			}),
		);
		const both = withSkills.getInstructions() ?? "";
		expect(both.startsWith("# Instrucciones del brain")).toBe(true);
		expect(both).toContain("skill_load");
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
		package: vi.fn(async (name: string) => ({
			name,
			version: 2,
			filename: `${name}-v2.zip`,
			url: "https://storage.test/firmado",
			expiresIn: 600,
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

	it("con catálogo aparecen las cuatro, las instrucciones y la lista en skill_load", async () => {
		const client = await connect(build(fakeCatalog()));
		const tools = (await client.listTools()).tools;
		expect(tools.map((t) => t.name).sort()).toEqual([
			"brain_read",
			"brain_search",
			"brain_upsert",
			"skill_file",
			"skill_list",
			"skill_load",
			"skill_package",
		]);
		expect(tools.find((t) => t.name === "skill_load")?.description).toContain(
			"- reporte: Arma el reporte mensual.",
		);
		expect(client.getInstructions()).toContain("skill_load");
		expect(client.getInstructions()).toContain("skill_package");
	});

	it("skill_package devuelve el link del catálogo y cuenta como lectura", async () => {
		const limiter = fakeLimiter();
		const catalog = fakeCatalog();
		const client = await connect(build(catalog, limiter));
		const result = await client.callTool({
			name: "skill_package",
			arguments: { name: "reporte" },
		});
		expect(result.structuredContent).toEqual({
			ok: true,
			name: "reporte",
			version: 2,
			filename: "reporte-v2.zip",
			url: "https://storage.test/firmado",
			expiresIn: 600,
		});
		expect(catalog.package).toHaveBeenCalledWith("reporte");
		expect(limiter.check).toHaveBeenCalledWith("read");
	});

	it("la descripción de skill_package dice que se baja a una carpeta temporal y no se instala", async () => {
		const client = await connect(build(fakeCatalog()));
		const description =
			(await client.listTools()).tools.find((t) => t.name === "skill_package")
				?.description ?? "";
		expect(description).toContain("10 minutos");
		expect(description).toContain("carpeta temporal");
		expect(description).toContain("no lo instales");
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

const change: DraftChange = {
	slug: "skills/ventas/reporte",
	name: "reporte",
	path: "SKILL.md",
	revision: 5,
	state: "con_cambios",
	reviewUrl: "https://agents.test/acme/brain/p/skills/ventas/reporte",
	message: "El cambio quedó en el borrador.",
};

function fakeDrafts(): SkillDrafts {
	return {
		read: vi.fn(async () => ({ slug: change.slug, skillMd: "---\n---\n" })),
		edit: vi.fn(async () => change),
		writeFile: vi.fn(async () => change),
		create: vi.fn(async () => change),
	};
}

describe("buildBrainMcpServer · edición de skills", () => {
	it("la descripción de skill_create dice dónde puede crear quien administra carpetas puntuales", async () => {
		const describe = async (creatableFolders?: string[]) => {
			const drafts = { ...fakeDrafts(), creatableFolders };
			const client = await connect(
				buildBrainMcpServer({
					userId: "ana",
					categories: ["comercial"],
					canon: false,
					provider: fakeProvider(),
					limiter: fakeLimiter(),
					skillDrafts: drafts,
				}),
			);
			return (
				(await client.listTools()).tools.find((t) => t.name === "skill_create")
					?.description ?? ""
			);
		};
		expect(await describe(["ventas", "rrhh"])).toContain(
			"solo en estas carpetas, y tenés que pasar una en folder: ventas, rrhh",
		);
		expect(await describe([])).toContain("No tenés carpetas donde crear");
		expect(await describe([""])).not.toContain("solo en estas carpetas");
		expect(await describe(undefined)).not.toContain("solo en estas carpetas");
	});

	function build(
		skillDrafts: SkillDrafts | null,
		limiter = fakeLimiter(),
		skills: SkillCatalog | null = null,
	) {
		return {
			limiter,
			server: buildBrainMcpServer({
				userId: "ana",
				categories: ["comercial"],
				canon: false,
				provider: fakeProvider(),
				limiter,
				skills,
				skillDrafts,
			}),
		};
	}

	it("sin skillDrafts no hay tools de edición", async () => {
		const client = await connect(build(null).server);
		const names = (await client.listTools()).tools.map((t) => t.name);
		expect(names.some((name) => name.startsWith("skill_"))).toBe(false);
		expect(client.getInstructions()).toBeUndefined();
	});

	it("con skillDrafts aparecen las cuatro, con sus anotaciones y las instrucciones", async () => {
		const client = await connect(build(fakeDrafts()).server);
		const tools = (await client.listTools()).tools;
		expect(tools.map((t) => t.name).sort()).toEqual([
			"brain_read",
			"brain_search",
			"brain_upsert",
			"skill_create",
			"skill_draft_edit",
			"skill_draft_read",
			"skill_draft_write_file",
		]);
		const byName = (name: string) => tools.find((t) => t.name === name);
		expect(byName("skill_draft_read")?.annotations?.readOnlyHint).toBe(true);
		for (const name of [
			"skill_draft_edit",
			"skill_draft_write_file",
			"skill_create",
		]) {
			expect(byName(name)?.annotations).toMatchObject({
				readOnlyHint: false,
				destructiveHint: name === "skill_draft_write_file",
			});
			expect(byName(name)?.description).toMatch(/borrador/i);
		}
		expect(client.getInstructions()).toContain("borrador");
	});

	it("sin skills publicadas las instrucciones no nombran skill_load ni skill_file", async () => {
		const client = await connect(build(fakeDrafts()).server);
		const instructions = client.getInstructions() ?? "";
		expect(instructions).toContain("skill_draft_read");
		expect(instructions).not.toContain("skill_load");
		expect(instructions).not.toContain("skill_file");
	});

	it("con skills publicadas las instrucciones aclaran que skill_load devuelve lo publicado", async () => {
		const client = await connect(
			build(fakeDrafts(), fakeLimiter(), fakeCatalog()).server,
		);
		const instructions = client.getInstructions() ?? "";
		expect(instructions).toContain("skill_load");
		expect(instructions).toContain("skill_draft_read");
	});

	it("la descripción de skill_create dice que folder es relativo a skills/", async () => {
		const client = await connect(build(fakeDrafts()).server);
		const create = (await client.listTools()).tools.find(
			(t) => t.name === "skill_create",
		);
		expect(create?.description).toContain("sin el prefijo skills/");
	});

	it("leer cuenta como lectura y escribir, como escritura; los argumentos llegan intactos", async () => {
		const drafts = fakeDrafts();
		const { server, limiter } = build(drafts);
		const client = await connect(server);

		const read = await client.callTool({
			name: "skill_draft_read",
			arguments: { skill: "reporte" },
		});
		expect(read.structuredContent).toMatchObject({
			ok: true,
			slug: change.slug,
		});
		expect(limiter.check).toHaveBeenLastCalledWith("read");

		const edit = await client.callTool({
			name: "skill_draft_edit",
			arguments: { skill: "reporte", old: "a", new: "b", reason: "r" },
		});
		expect(edit.structuredContent).toMatchObject({ ok: true, revision: 5 });
		expect(drafts.edit).toHaveBeenCalledWith({
			skill: "reporte",
			old: "a",
			new: "b",
			reason: "r",
		});
		expect(limiter.check).toHaveBeenLastCalledWith("write");

		await client.callTool({
			name: "skill_draft_write_file",
			arguments: { skill: "reporte", path: "references/x.md", content: "x" },
		});
		await client.callTool({
			name: "skill_create",
			arguments: {
				name: "nueva",
				description: "d",
				instructions: "i",
				reason: "r",
			},
		});
		expect(drafts.writeFile).toHaveBeenCalledTimes(1);
		expect(drafts.create).toHaveBeenCalledTimes(1);
	});

	it("un error de BrainError sale con el formato de siempre y como error", async () => {
		const drafts = fakeDrafts();
		drafts.edit = vi.fn(async () => {
			throw new BrainError("validation", "El fragmento no aparece.");
		});
		const client = await connect(build(drafts).server);
		const result = await client.callTool({
			name: "skill_draft_edit",
			arguments: { skill: "reporte", old: "a", new: "b", reason: "r" },
		});
		expect(result.isError).toBe(true);
		expect(result.structuredContent).toMatchObject({
			ok: false,
			error: "validation",
			message: "El fragmento no aparece.",
		});
	});
});

describe("buildBrainMcpServer · carpetas y borrado", () => {
	const manage = {
		createFolders: vi.fn(async () => ({ results: [] })),
		delete: vi.fn(async () => ({ deleted: [], skipped: [], remaining: 0 })),
	};
	const build = (withManage: boolean, provider = fakeProvider()) =>
		buildBrainMcpServer({
			userId: "belisario",
			categories: ["marketing"],
			canon: false,
			provider,
			limiter: fakeLimiter(),
			manage: withManage ? manage : null,
		});

	it("las tools aparecen solo con manage, y el borrado se marca destructivo", async () => {
		const sin = await connect(build(false));
		expect((await sin.listTools()).tools.map((t) => t.name)).not.toContain(
			"brain_delete",
		);
		const con = await connect(build(true));
		const tools = (await con.listTools()).tools;
		expect(tools.map((t) => t.name)).toEqual(
			expect.arrayContaining(["brain_delete", "brain_folder_create"]),
		);
		expect(
			tools.find((t) => t.name === "brain_delete")?.annotations
				?.destructiveHint,
		).toBe(true);
	});

	it("cuenta una escritura y pasa la entrada tal cual", async () => {
		const limiter = fakeLimiter();
		const server = buildBrainMcpServer({
			userId: "belisario",
			categories: ["marketing"],
			canon: false,
			provider: fakeProvider(),
			limiter,
			manage,
		});
		const client = await connect(server);
		await client.callTool({
			name: "brain_delete",
			arguments: { folder: "marketing", includeSubfolders: true },
		});
		expect(limiter.check).toHaveBeenCalledWith("write");
		expect(manage.delete).toHaveBeenCalledWith({
			folder: "marketing",
			includeSubfolders: true,
		});
	});

	it("brain_upsert, si falta la carpeta y administra, le dice cómo crearla", async () => {
		const provider = fakeProvider();
		provider.upsert = vi.fn(async () => {
			throw new BrainValidation(
				["folder"],
				"No existe la carpeta marketing/marca. Pedile a un administrador que la cree.",
			);
		});
		const upsert = {
			slug: "marketing/marca/logo",
			title: "Logo",
			category: "marketing",
			status: "activo",
			tags: [],
			body: "x",
			reason: "r",
		};
		const con = await connect(build(true, provider));
		const result = await con.callTool({
			name: "brain_upsert",
			arguments: upsert,
		});
		expect(result.isError).toBe(true);
		const message = (result.structuredContent as { message: string }).message;
		expect(message).toContain("No existe la carpeta marketing/marca.");
		expect(message).toContain("brain_folder_create");

		const sin = await connect(build(false, provider));
		const plain = await sin.callTool({
			name: "brain_upsert",
			arguments: upsert,
		});
		expect(
			(plain.structuredContent as { message: string }).message,
		).not.toContain("brain_folder_create");
	});
});
