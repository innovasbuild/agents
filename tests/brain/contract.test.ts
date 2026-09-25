import { describe, expect, it } from "vitest";
import {
	BRAIN_TOOL_NAMES,
	brainContract,
	brainResultSchemas,
} from "@/lib/brain/contract";

describe("brainContract", () => {
	const contract = brainContract(["comercial", "producto"]);

	it("usa las categorías del binding en búsqueda y escritura", () => {
		expect(
			contract.search.input.safeParse({ query: "", category: "comercial" })
				.success,
		).toBe(true);
		expect(
			contract.search.input.safeParse({ query: "", category: "otra" }).success,
		).toBe(false);
		expect(
			contract.upsert.input.safeParse({
				slug: "producto/radar",
				title: "Radar",
				category: "otra",
				status: "activo",
				tags: [],
				body: "x",
				reason: "alta",
			}).success,
		).toBe(false);
	});

	it("descarta claves desconocidas: un tenantId en los argumentos no pasa", () => {
		const parsed = contract.search.input.parse({
			query: "icp",
			tenantId: "otro-tenant",
		});
		expect(parsed).toEqual({ query: "icp" });
		const read = contract.read.input.parse({
			slug: "comercial/icp",
			tenantId: "x",
		});
		expect(read).toEqual({ slug: "comercial/icp" });
	});

	it("las descripciones no prometen aprobación: eso lo agrega cada superficie", () => {
		expect(contract.upsert.description).not.toMatch(/aprueba/i);
	});

	it("sin categorías no hay contrato", () => {
		expect(() => brainContract([])).toThrow("categoría");
	});

	it("los nombres de las tools son los de siempre", () => {
		expect(BRAIN_TOOL_NAMES).toEqual({
			search: "brain_search",
			read: "brain_read",
			upsert: "brain_upsert",
		});
	});
});

describe("brainResultSchemas", () => {
	it("valida una página leída y rechaza una sin revisión", () => {
		const page = {
			slug: "comercial/icp",
			title: "ICP",
			category: "comercial",
			status: "activo",
			tags: ["canon:icp"],
			frontmatter: {},
			body: "…",
			revision: 3,
			updatedAt: "2026-09-24T00:00:00Z",
		};
		expect(brainResultSchemas.read.safeParse({ ok: true, page }).success).toBe(
			true,
		);
		const { revision: _omitted, ...sinRevision } = page;
		expect(
			brainResultSchemas.read.safeParse({ ok: true, page: sinRevision })
				.success,
		).toBe(false);
	});

	it("valida el resultado de una escritura", () => {
		expect(
			brainResultSchemas.upsert.safeParse({ ok: true, slug: "a", revision: 1 })
				.success,
		).toBe(true);
		expect(
			brainResultSchemas.upsert.safeParse({ ok: true, slug: "a" }).success,
		).toBe(false);
	});
});
