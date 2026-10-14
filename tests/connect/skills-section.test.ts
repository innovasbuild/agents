import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SkillsSection } from "@/app/[tenant]/conectar/skills-section";

const skills = [
	{
		slug: "skills/ventas/propuesta",
		name: "propuesta",
		description: "Arma la propuesta comercial.",
		version: 3,
	},
];

const render = (list: typeof skills | null) =>
	renderToStaticMarkup(
		createElement(SkillsSection, { tenantSlug: "acme", skills: list }),
	);

describe("SkillsSection", () => {
	it("lista cada skill con su versión, su página y la descarga del paquete", () => {
		const html = render(skills);
		expect(html).toContain("Tus skills");
		expect(html).toContain("propuesta");
		expect(html).toContain("Arma la propuesta comercial.");
		expect(html).toContain("/acme/brain/p/skills/ventas/propuesta");
		expect(html).toContain(
			"/acme/brain/skills/package?slug=skills%2Fventas%2Fpropuesta",
		);
		expect(html).toContain("Descargar paquete (v3)");
	});

	it("explica qué pasa en cada cliente", () => {
		const html = render(skills);
		expect(html).toContain("Claude Code, Codex y Cursor");
		expect(html).toContain("usa siempre la última versión");
		expect(html).toContain("claude.ai y ChatGPT");
		expect(html).toContain("subirlo de nuevo");
	});

	it("si la lectura falló, lo dice en vez de mostrar una lista vacía", () => {
		const html = render(null);
		expect(html).toContain(
			"No se pudieron leer tus skills. Recargá la página.",
		);
		expect(html).not.toContain("Descargar paquete");
	});
});
