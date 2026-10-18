import { describe, expect, it, vi } from "vitest";
import type { BrainPage, BrainProvider } from "@/lib/brain/core/types";

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({}) }));

const fakeBrain: { current: BrainProvider | null } = { current: null };
vi.mock("@/lib/brain/adapters/provider", () => ({
	getBrainProvider: () => fakeBrain.current,
}));
vi.mock("@/lib/brain/core/resolve", () => ({
	resolveBrainBinding: async () => ({ tenantId: "t" }),
}));
vi.mock("@/lib/connectors/bindings", () => ({ loadTenantBindings: vi.fn() }));

const { brainForTenant, loadCanon, loadIcpLevels, loadMarco } = await import(
	"@/lib/outreach/canon"
);

const page = (
	slug: string,
	tags: string[],
	body: string,
	status: BrainPage["status"] = "activo",
): BrainPage => ({
	slug,
	title: slug,
	category: "comercial",
	status,
	tags,
	frontmatter: {},
	body,
	revision: 1,
	updatedAt: "2026-10-10",
});

function brainWith(pages: BrainPage[]): BrainProvider {
	return {
		search: async ({ tag }) =>
			pages
				.filter((p) => !tag || p.tags.includes(tag))
				.map((p) => ({
					slug: p.slug,
					title: p.title,
					category: p.category,
					status: p.status,
					tags: p.tags,
					snippet: "",
					updatedAt: p.updatedAt,
				})),
		read: async (slug) => {
			const found = pages.find((p) => p.slug === slug);
			if (!found) throw new Error("no existe");
			return found;
		},
		list: async () => [],
		listMeta: async () => [],
		listLinks: async () => [],
		history: async () => null,
		upsert: async () => {
			throw new Error("no se usa");
		},
	};
}

const ICP_BODY = [
	"```icp",
	"encaje: No es del universo: rubro ajeno o tamaño fuera de rango",
	"encaje: Encaja bien: tamaño y rubro del perfil buscado",
	"rol: Sin relación con esta decisión de compra",
	"rol: Decide: tiene control sobre el presupuesto",
	"excluir: La empresa es competidora, cliente o proveedora",
	"```",
].join("\n");
const MARCO_BODY =
	"```hooks\nh_uno: Uno\n```\n\n```vectores\nv_uno: Vector => h_uno\n```";

describe("loadIcpLevels", () => {
	it("sin brain", async () => {
		expect(await loadIcpLevels(null)).toEqual({
			ok: false,
			reason: "sin_brain",
			errors: [],
		});
	});

	it("lee el bloque de la página activa", async () => {
		const result = await loadIcpLevels(
			brainWith([page("comercial/icp", ["canon:icp"], ICP_BODY)]),
		);
		expect(result).toMatchObject({
			ok: true,
			value: { excluir: "La empresa es competidora, cliente o proveedora" },
		});
	});

	it("una página en borrador no cuenta: falta", async () => {
		expect(
			await loadIcpLevels(
				brainWith([page("comercial/icp", ["canon:icp"], ICP_BODY, "borrador")]),
			),
		).toEqual({ ok: false, reason: "falta", errors: [] });
	});

	it("el borrador con la plantilla no rompe el ICP de la página activa", async () => {
		const result = await loadIcpLevels(
			brainWith([
				page(
					"comercial/icp",
					["canon:icp"],
					"```icp\n# completar\n```",
					"borrador",
				),
				page("comercial/criterios", ["canon:icp"], ICP_BODY),
			]),
		);
		expect(result.ok).toBe(true);
	});

	it("bloque roto: inválido con sus errores", async () => {
		const result = await loadIcpLevels(
			brainWith([
				page("comercial/icp", ["canon:icp"], "```icp\nencaje: corto\n```"),
			]),
		);
		expect(result).toMatchObject({ ok: false, reason: "invalido" });
		expect(result.ok === false && result.errors.length).toBeGreaterThan(0);
	});

	it("el brain falla: brain_caido, sin tirar", async () => {
		const broken = {
			...brainWith([]),
			search: async () => {
				throw new Error("timeout");
			},
		};
		expect(await loadIcpLevels(broken)).toEqual({
			ok: false,
			reason: "brain_caido",
			errors: [],
		});
	});
});

describe("tope de páginas por tag", () => {
	const many = (n: number, tag: string, body: string) =>
		Array.from({ length: n }, (_, i) => page(`comercial/p${i}`, [tag], body));

	it("seis páginas canon:icp: inválido, nombra el tag y el tope", async () => {
		const result = await loadIcpLevels(
			brainWith(many(6, "canon:icp", "prosa")),
		);
		expect(result).toMatchObject({ ok: false, reason: "invalido" });
		expect(result.ok === false && result.errors[0]).toContain("canon:icp");
		expect(result.ok === false && result.errors[0]).toContain("5");
	});

	it("cinco páginas canon:icp: se leen (no es error de carga)", async () => {
		const result = await loadIcpLevels(
			brainWith([
				...many(4, "canon:icp", "prosa"),
				page("comercial/icp", ["canon:icp"], ICP_BODY),
			]),
		);
		expect(result.ok).toBe(true);
	});

	it("seis páginas canon:hooks: inválido, nombra el tag y el tope", async () => {
		const result = await loadMarco(brainWith(many(6, "canon:hooks", "prosa")));
		expect(result).toMatchObject({ ok: false, reason: "invalido" });
		expect(result.ok === false && result.errors[0]).toContain("canon:hooks");
		expect(result.ok === false && result.errors[0]).toContain("5");
	});

	it("cinco páginas canon:hooks: se leen", async () => {
		const result = await loadMarco(
			brainWith([
				...many(4, "canon:hooks", "prosa"),
				page("comercial/hooks", ["canon:hooks"], MARCO_BODY),
			]),
		);
		expect(result.ok).toBe(true);
	});
});

describe("loadMarco", () => {
	it("lee hooks y vectores de las páginas activas", async () => {
		expect(
			await loadMarco(
				brainWith([page("comercial/hooks", ["canon:hooks"], MARCO_BODY)]),
			),
		).toEqual({
			ok: true,
			value: {
				hooks: [{ value: "h_uno", label: "Uno" }],
				vectores: [{ value: "v_uno", label: "Vector", default_hook: "h_uno" }],
			},
		});
	});

	it("solo prosa o solo borradores: falta", async () => {
		expect(
			await loadMarco(
				brainWith([
					page("comercial/redaccion", ["canon:hooks"], "prosa"),
					page("comercial/hooks", ["canon:hooks"], MARCO_BODY, "borrador"),
				]),
			),
		).toEqual({ ok: false, reason: "falta", errors: [] });
	});

	it("bloque roto: inválido", async () => {
		expect(
			await loadMarco(
				brainWith([
					page("comercial/hooks", ["canon:hooks"], "```hooks\nh_uno: Uno\n```"),
				]),
			),
		).toEqual({
			ok: false,
			reason: "invalido",
			errors: [
				"faltan vectores: tiene que haber al menos uno en un bloque vectores",
			],
		});
	});
});

describe("brainForTenant y las skills", () => {
	it("una skill con tag de canon no llega a loadCanon", async () => {
		fakeBrain.current = brainWith([
			page("comercial/icp", ["canon:icp"], "icp visible"),
			page("skills/robada", ["canon:icp", "canon:voz"], "cuerpo de la skill"),
		]);
		const brain = await brainForTenant("t");
		const canon = await loadCanon(brain, null);
		const bodies = [...canon.pages, ...canon.voice].map((p) => p.body);
		expect(bodies).toContain("icp visible");
		expect(bodies).not.toContain("cuerpo de la skill");
		await expect(brain?.read("skills/robada")).rejects.toThrow();
	});
});
