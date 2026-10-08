import { describe, expect, it } from "vitest";
import { planLinkCleanup } from "@/lib/brain/core/links-cleanup";
import type { BrainPage } from "@/lib/brain/core/types";

const page = (
	slug: string,
	body: string,
	over: Partial<BrainPage> = {},
): BrainPage => ({
	slug,
	title: slug.split("/").pop() ?? slug,
	category: "comercial",
	status: "activo",
	tags: [],
	frontmatter: {},
	body,
	revision: 3,
	updatedAt: "2026-10-08T00:00:00Z",
	...over,
});

const T = "comercial/icp";

describe("planLinkCleanup", () => {
	const pages = [
		page(T, "Yo me enlazo [[comercial/icp]]", { title: "Perfil ICP" }),
		page("legal/contrato", "Ver [[comercial/icp|el perfil]]."),
		page("legal/viejo", "Ver [[comercial/icp]].", {
			status: "archivado",
			revision: 7,
		}),
		page("legal/otra", "Nada que ver [[suelta]]."),
		page("legal/codigo", "Solo en `[[comercial/icp]]` código."),
	];

	it("incluye solo las páginas cuyo cuerpo cambia, con su revisión vigente", () => {
		const plan = planLinkCleanup(pages, T);
		expect(plan.map((i) => i.slug)).toEqual(["legal/contrato", "legal/viejo"]);
		expect(plan[1].baseRevision).toBe(7);
	});

	it("incluye las archivadas y excluye la propia página aunque se enlace a sí misma", () => {
		const slugs = planLinkCleanup(pages, T).map((i) => i.slug);
		expect(slugs).toContain("legal/viejo");
		expect(slugs).not.toContain(T);
	});

	it("usa el título de la página borrada cuando el link no tiene alias", () => {
		const plan = planLinkCleanup(pages, T);
		expect(plan[0].body).toBe("Ver el perfil.");
		expect(plan[1].body).toBe("Ver Perfil ICP.");
	});

	it("devuelve el título de cada página limpiada", () => {
		expect(planLinkCleanup(pages, T)[0].title).toBe("contrato");
	});

	it("si la página a borrar no está entre las páginas, usa el destino como texto", () => {
		const plan = planLinkCleanup([page("a", "[[x/y]]")], "x/y");
		expect(plan[0].body).toBe("x/y");
	});

	it("sin links al destino, el plan queda vacío", () => {
		expect(planLinkCleanup([page("a", "hola")], T)).toEqual([]);
	});
});
