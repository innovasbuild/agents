// tests/brain/reserved-notice.test.ts
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ReservedNoticeBox } from "@/components/brain/reserved-notice";
import { reservedNotice } from "@/lib/brain/core/editor/reserved";
import { nodeBuiltins } from "./client-safe";

const render = (slug: string, length: number) => {
	const notice = reservedNotice(slug);
	if (!notice) throw new Error("esperaba un aviso");
	return renderToStaticMarkup(
		createElement(ReservedNoticeBox, { notice, length }),
	);
};

describe("ReservedNoticeBox", () => {
	it("explica las instrucciones del brain y cuenta contra 12 000", () => {
		const html = render("00-reglas", 11_500);
		expect(html).toContain('role="note"');
		expect(html).toContain("Instrucciones del brain");
		expect(html).toContain("11.500 de 12.000 caracteres");
		expect(html).not.toContain("text-destructive");
	});

	it("pasado el tope lo marca", () => {
		const html = render("talento/personal/00-reglas", 20_001);
		expect(html).toContain("20.001 de 20.000 caracteres");
		expect(html).toContain("text-destructive");
		expect(html).toContain("no se puede guardar activa");
	});

	it("la plantilla no tiene contador", () => {
		const html = render("comercial/00-plantilla", 50);
		expect(html).toContain("Plantilla de comercial");
		expect(html).not.toContain("caracteres");
	});

	it("una regla avisa que en borrador no aplica y que el chat no la escribe", () => {
		const html = render("comercial/00-reglas", 10);
		expect(html).toContain("Una regla en borrador no aplica");
		expect(html).toContain("el asistente del chat nunca las escribe");
		expect(render("comercial/00-plantilla", 10)).not.toContain(
			"en borrador no aplica",
		);
	});

	it("no alcanza node:* por imports de runtime", () => {
		expect(nodeBuiltins("components/brain/reserved-notice.tsx")).toEqual([]);
	});
});
