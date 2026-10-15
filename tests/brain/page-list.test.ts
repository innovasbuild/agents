import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PageList } from "@/components/brain/page-list";
import type { BrainPage } from "@/lib/brain/core/types";

const page = (slug: string): BrainPage => ({
	slug,
	title: slug,
	category: "talento",
	status: "activo",
	tags: [],
	frontmatter: {},
	body: "",
	revision: 1,
	updatedAt: "2026-10-15T00:00:00Z",
});

const render = (pages: BrainPage[]) =>
	renderToStaticMarkup(
		createElement(PageList, { pages, tenantSlug: "acme", counts: new Map() }),
	);

describe("PageList", () => {
	it("una 00-reglas lleva la insignia Reglas", () => {
		expect(render([page("talento/personal/00-reglas")])).toContain(">Reglas<");
	});

	it("una página común no la lleva", () => {
		const html = render([page("talento/personal/leo")]);
		expect(html).not.toContain(">Reglas<");
		expect(html).not.toContain(">Plantilla<");
	});
});
