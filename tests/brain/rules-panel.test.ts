// tests/brain/rules-panel.test.ts
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { nodeBuiltins } from "./client-safe";

vi.mock("@/app/[tenant]/brain/rules-actions", () => ({
	loadNewPageRules: vi.fn(),
}));
vi.mock("next/link", () => ({
	default: (props: Record<string, unknown>) => createElement("a", props),
}));

const { RulesPanel } = await import("@/components/brain/rules-panel");

const entry = (over: Record<string, unknown> = {}) => ({
	path: "talento/personal",
	slug: "talento/personal/00-reglas",
	title: "Reglas de talento/personal",
	body: "Cada ficha lleva **reporta_a**.",
	visible: true,
	...over,
});

const render = (view: unknown) =>
	renderToStaticMarkup(
		createElement(RulesPanel, {
			tenantSlug: "acme",
			view: view as never,
			pages: [],
		}),
	);

describe("RulesPanel", () => {
	it("muestra cuántas aplican, cada título y el link a cada 00-reglas", () => {
		const html = render({
			kind: "rules",
			entries: [
				entry({
					path: "",
					slug: "00-reglas",
					title: "Instrucciones del brain",
				}),
				entry(),
			],
		});
		expect(html).toContain("Reglas que aplican");
		expect(html).toContain("(2)");
		expect(html).toContain("Instrucciones del brain");
		expect(html).toContain('href="/acme/brain/p/talento/personal/00-reglas"');
	});

	it("una regla que la persona no puede abrir va sin link", () => {
		const html = render({
			kind: "rules",
			entries: [entry({ visible: false })],
		});
		expect(html).toContain("Reglas de talento/personal");
		expect(html).not.toContain("href=");
	});

	it("el cuerpo se muestra como markdown y el HTML queda como texto", () => {
		const html = render({
			kind: "rules",
			entries: [
				entry({
					body: '<script>alert(1)</script>\n\n<img src=x onerror="alert(2)">\n\n**importante**',
				}),
			],
		});
		expect(html).toContain("<strong>importante</strong>");
		expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
		expect(html).not.toContain("<script");
		expect(html).not.toContain("<img");
	});

	it("si no se pudieron leer, lo dice", () => {
		const html = render({ kind: "error", message: "No se pudieron leer." });
		expect(html).toContain('role="alert"');
		expect(html).toContain("No se pudieron leer.");
	});
});

describe("frontera de cliente", () => {
	it("el panel y el espacio de trabajo importan rules-panel solo como tipo", () => {
		for (const file of [
			"components/brain/rules-panel.tsx",
			"components/brain/editor/page-workspace.tsx",
		]) {
			const source = readFileSync(file, "utf8");
			const lines = source
				.split("\n")
				.filter((line) => line.includes("core/editor/rules-panel"));
			expect(lines.every((line) => line.startsWith("import type"))).toBe(true);
			expect(source).not.toMatch(/core\/rules(-source)?["']/);
		}
	});

	it("el panel no alcanza node:* por imports de runtime", () => {
		expect(nodeBuiltins("components/brain/rules-panel.tsx")).toEqual([]);
	});

	it("el resumen lleva un indicador de que se despliega", () => {
		const html = render({ kind: "rules", entries: [entry()] });
		expect(html).toMatch(
			/<summary[^>]*>(?:(?!<\/summary>)[\s\S])*<svg[^>]*aria-hidden="true"/,
		);
		expect(html).toContain("group-open:rotate-180");
	});
});
