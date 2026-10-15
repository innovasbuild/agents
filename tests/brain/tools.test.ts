import { describe, expect, it, vi } from "vitest";
import { createBrainTools } from "@/lib/brain/adapters/tools";
import type { BrainBinding } from "@/lib/brain/core/resolve";
import type { RulePage } from "@/lib/brain/core/rules";
import { createWikiRules, EMPTY_RULES } from "@/lib/brain/core/rules-source";
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

function fakeProvider(): BrainProvider {
	return {
		search: vi.fn(async () => []),
		read: vi.fn(),
		list: async () => [],
		history: async () => null,
		upsert: vi.fn(async () => ({ slug: "a", revision: 1 })),
	};
}

const noRules = () => EMPTY_RULES;

describe("createBrainTools", () => {
	it("con acceso de lectura devuelve solo búsqueda y lectura", () => {
		const tools = createBrainTools(binding, "read", { provider: fakeProvider });
		expect(Object.keys(tools).sort()).toEqual([
			"brain_read",
			"brain_rules",
			"brain_search",
		]);
	});

	it("con lectura y escritura suma brain_upsert, con aprobación", () => {
		const tools = createBrainTools(binding, "read_write", {
			provider: fakeProvider,
		});
		expect(Object.keys(tools).sort()).toEqual([
			"brain_read",
			"brain_rules",
			"brain_search",
			"brain_upsert",
		]);
		expect("brain_upsert" in tools && tools.brain_upsert.approval).toBeTruthy();
		expect(tools.brain_search.approval).toBeUndefined();
	});

	it("brain_search y brain_read siguen llamando al provider inyectado al ejecutar", async () => {
		const summary = {
			slug: "a",
			title: "A",
			category: "comercial",
			status: "activo" as const,
			tags: [],
			snippet: "",
			updatedAt: "2026-01-01",
		};
		const page = {
			slug: "a",
			title: "A",
			category: "comercial",
			status: "activo" as const,
			tags: [],
			frontmatter: {},
			body: "",
			revision: 1,
			updatedAt: "2026-01-01",
		};
		const search = vi.fn(async () => [summary]);
		const read = vi.fn(async () => page);
		const providerFactory = vi.fn(() => ({
			search,
			read,
			list: async () => [],
			history: async () => null,
			upsert: vi.fn(async () => ({ slug: "a", revision: 1 })),
		}));
		const tools = createBrainTools(binding, "read", {
			provider: providerFactory,
			rulesSource: noRules,
		});

		const searchResult = await tools.brain_search.execute(
			{ query: "hola" },
			{} as never,
		);
		const readResult = await tools.brain_read.execute(
			{ slug: "a" },
			{} as never,
		);

		expect(providerFactory).toHaveBeenCalledWith(binding);
		expect(search).toHaveBeenCalledWith({ query: "hola" });
		expect(read).toHaveBeenCalledWith("a");
		expect(searchResult).toMatchObject({ ok: true });
		expect(readResult).toMatchObject({ ok: true });
	});

	it("la descripción de brain_upsert del agente avisa que la aprueba un administrador", () => {
		const tools = createBrainTools(binding, "read_write", {
			provider: fakeProvider,
		});
		const description =
			"brain_upsert" in tools ? String(tools.brain_upsert.description) : "";
		expect(description).toMatch(/aprueba un administrador/);
	});

	describe("con una persona como actor", () => {
		const closeDireccion = [
			{
				path: "",
				principal: "members" as const,
				userId: null,
				level: "lector" as const,
			},
			{
				path: "direccion",
				principal: "members" as const,
				userId: null,
				level: "ninguno" as const,
			},
		];
		const pageOf = (slug: string) => ({
			slug,
			title: slug,
			category: "comercial",
			status: "activo" as const,
			tags: [],
			snippet: "",
			updatedAt: "2026-01-01",
		});
		const member = { userId: "ana", role: "tenant_member" as const };

		function providerWith(
			upsert = vi.fn(async () => ({ slug: "a", revision: 2 })),
		) {
			return {
				search: vi.fn(async () => [
					pageOf("comercial/icp"),
					pageOf("direccion/x"),
				]),
				read: vi.fn(),
				list: async () => [],
				history: async () => null,
				upsert,
			};
		}

		it("brain_search filtra lo que el miembro no ve", async () => {
			const provider = providerWith();
			const tools = createBrainTools(binding, "read", {
				actor: member,
				provider: () => provider,
				rules: async () => closeDireccion,
			});
			const result = await tools.brain_search.execute(
				{ query: "x" },
				{} as never,
			);
			expect(result).toMatchObject({ ok: true });
			expect(
				"results" in result ? result.results.map((r) => r.slug) : [],
			).toEqual(["comercial/icp"]);
		});

		it("brain_upsert de un miembro sin permiso de editor es forbidden aunque un administrador lo apruebe", async () => {
			const upsert = vi.fn(async () => ({ slug: "a", revision: 2 }));
			const tools = createBrainTools(binding, "read_write", {
				actor: member,
				provider: () => providerWith(upsert),
				rules: async () => closeDireccion,
				rulesSource: noRules,
			});
			expect("brain_upsert" in tools).toBe(true);
			if (!("brain_upsert" in tools)) return;
			const result = await tools.brain_upsert.execute(
				{
					slug: "otros/x",
					title: "t",
					category: "comercial",
					status: "activo",
					tags: [],
					body: "b",
					reason: "r",
					baseRevision: 1,
				},
				{
					session: {
						id: "s1",
						auth: { initiator: { principalType: "user", principalId: "ana" } },
					},
				} as never,
			);
			expect(result).toMatchObject({ ok: false, error: "forbidden" });
			expect(upsert).not.toHaveBeenCalled();
		});

		it("sin actor el agente desatendido conserva todo el acceso", async () => {
			const provider = providerWith();
			const tools = createBrainTools(binding, "read", {
				provider: () => provider,
				rules: async () => closeDireccion,
			});
			const result = await tools.brain_search.execute(
				{ query: "x" },
				{} as never,
			);
			expect("results" in result ? result.results : []).toHaveLength(2);
		});
	});

	describe("skills", () => {
		const skillBinding: BrainBinding = {
			...binding,
			config: { ...binding.config, categories: ["comercial", "skill"] },
		} as BrainBinding;
		const summary = (slug: string) => ({
			slug,
			title: slug,
			category: slug.startsWith("skills/") ? "skill" : "comercial",
			status: "activo" as const,
			tags: [],
			snippet: "",
			updatedAt: "2026-01-01",
		});

		function setup() {
			const read = vi.fn();
			const upsert = vi.fn(async () => ({ slug: "a", revision: 1 }));
			const tools = createBrainTools(skillBinding, "read_write", {
				provider: () => ({
					search: async () => [
						summary("comercial/icp"),
						summary("skills/facturacion"),
					],
					read,
					list: async () => [],
					history: async () => null,
					upsert,
				}),
				rulesSource: noRules,
			});
			return { tools, read, upsert };
		}

		it("brain_search no devuelve nada bajo skills/", async () => {
			const { tools } = setup();
			const result = await tools.brain_search.execute(
				{ query: "" },
				{} as never,
			);
			expect(
				(result as { results: Array<{ slug: string }> }).results.map(
					(r) => r.slug,
				),
			).toEqual(["comercial/icp"]);
		});

		it("brain_read de una skill responde not_found sin tocar el proveedor", async () => {
			const { tools, read } = setup();
			const result = await tools.brain_read.execute(
				{ slug: "skills/facturacion" },
				{} as never,
			);
			expect(result).toMatchObject({ ok: false, error: "not_found" });
			expect(read).not.toHaveBeenCalled();
		});

		it("brain_upsert rechaza la ruta skills/ y no escribe", async () => {
			const { tools, upsert } = setup();
			if (!("brain_upsert" in tools)) throw new Error("falta brain_upsert");
			const result = await tools.brain_upsert.execute(
				{
					slug: "skills/x",
					title: "x",
					category: "comercial",
					status: "activo",
					tags: [],
					body: "b",
					reason: "r",
				},
				{ session: { id: "s1", auth: { initiator: null } } } as never,
			);
			expect(result).toMatchObject({ ok: false, error: "forbidden" });
			expect(upsert).not.toHaveBeenCalled();
		});
	});
});

describe("reglas en las tools del agente", () => {
	const pageOf = (slug: string) => ({
		slug,
		title: slug,
		category: "comercial",
		status: "activo" as const,
		tags: [],
		frontmatter: {},
		body: "b",
		revision: 1,
		updatedAt: "2026-01-01",
	});
	const pages: RulePage[] = [
		{ slug: "00-reglas", status: "activo", revision: 1, body: "raíz" },
		{
			slug: "comercial/00-reglas",
			status: "activo",
			revision: 3,
			body: "comercial",
		},
	];
	const rulesSource = () =>
		createWikiRules({
			tenantId: "tenant-a",
			store: { listRulePages: async () => pages, listFolders: async () => [] },
		});
	const ctx = { session: { id: "s1", auth: { initiator: null } } } as never;
	const input = {
		slug: "comercial/nueva",
		title: "Nueva",
		category: "comercial",
		status: "activo" as const,
		tags: [],
		body: "b",
		reason: "alta",
	};

	function setup() {
		const upsert = vi.fn(async () => ({
			slug: "comercial/nueva",
			revision: 1,
		}));
		const providerFactory = vi.fn(() => ({
			search: vi.fn(async () => []),
			read: vi.fn(async (slug: string) => pageOf(slug)),
			list: async () => [],
			history: async () => null,
			upsert,
		}));
		const tools = createBrainTools(binding, "read_write", {
			provider: providerFactory,
			rulesSource,
		});
		if (!("brain_upsert" in tools)) throw new Error("falta brain_upsert");
		return { tools, upsert, providerFactory };
	}

	it("brain_rules devuelve la cascada completa de una ruta que no existe", async () => {
		const { tools } = setup();
		const result = await tools.brain_rules.execute(
			{ path: "comercial/nueva" },
			{} as never,
		);
		expect(result).toMatchObject({
			ok: true,
			rules: { chain: [{ path: "" }, { path: "comercial" }] },
		});
	});

	it("brain_read trae las reglas de la carpeta sin la raíz", async () => {
		const { tools } = setup();
		const result = await tools.brain_read.execute(
			{ slug: "comercial/icp" },
			{} as never,
		);
		expect(result).toMatchObject({
			ok: true,
			rules: { chain: [{ path: "comercial" }] },
		});
	});

	it("brain_upsert sin rulesRevision devuelve rules_required y no escribe; el reintento entra", async () => {
		const { tools, upsert } = setup();
		const first = await tools.brain_upsert.execute(input, ctx);
		expect(first).toMatchObject({ ok: false, error: "rules_required" });
		expect(upsert).not.toHaveBeenCalled();
		const revision = (first as { rules: { revision: string } }).rules.revision;
		const second = await tools.brain_upsert.execute(
			{ ...input, rulesRevision: revision },
			ctx,
		);
		expect(second).toMatchObject({ ok: true });
		expect((upsert.mock.calls[0] as unknown[])[0]).not.toHaveProperty(
			"rulesRevision",
		);
	});

	it("el agente no escribe una 00-plantilla ni una 00-reglas, sin armar el proveedor", async () => {
		const { tools, upsert, providerFactory } = setup();
		for (const slug of [
			"comercial/00-plantilla",
			"comercial/00-reglas",
			"00-reglas",
		]) {
			const result = await tools.brain_upsert.execute({ ...input, slug }, ctx);
			expect(result).toMatchObject({ ok: false, error: "reserved_slug" });
			expect((result as { message: string }).message).toContain(
				"proponé el cambio en la conversación",
			);
		}
		expect(providerFactory).not.toHaveBeenCalled();
		expect(upsert).not.toHaveBeenCalled();
	});

	it("un miembro no recibe las reglas de una ruta que no ve", async () => {
		const tools = createBrainTools(binding, "read", {
			actor: { userId: "ana", role: "tenant_member" },
			provider: () => ({
				search: vi.fn(async () => []),
				read: vi.fn(),
				list: async () => [],
				history: async () => null,
				upsert: vi.fn(),
			}),
			rules: async () => [
				{
					path: "comercial",
					principal: "members",
					userId: null,
					level: "ninguno",
				},
			],
			rulesSource,
		});
		const result = await tools.brain_rules.execute(
			{ path: "comercial/nueva" },
			{} as never,
		);
		expect(result).toMatchObject({ ok: false, error: "not_found" });
	});
});
