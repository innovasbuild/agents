import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { Connectable } from "@/lib/connect/connectables";

const { ConnectCard } = await import("@/app/[tenant]/conectar/connect-card");

const render = (connectable: Connectable) =>
	renderToStaticMarkup(createElement(ConnectCard, { connectable }));

const agent: Connectable = {
	kind: "agent",
	agent: "outreach",
	id: "outreach-acme",
	name: "Agente de outreach",
	description: "Investiga cuentas.",
	url: "https://app.test/eve/outreach/v1/mcp?tenant=acme",
};

describe("ConnectCard", () => {
	it("muestra nombre, descripción y la URL en un campo de solo lectura", () => {
		const html = render(agent);
		const input = html.match(/<input[^>]*>/)?.[0] ?? "";

		expect(html).toContain("Agente de outreach");
		expect(html).toContain("Investiga cuentas.");
		expect(input).toMatch(/readOnly=""/i);
		expect(input).toContain(
			'value="https://app.test/eve/outreach/v1/mcp?tenant=acme"',
		);
	});

	it("tiene una pestaña por cliente", () => {
		const html = render(agent);
		for (const label of [
			"Claude Code",
			"claude.ai",
			"ChatGPT",
			"Codex",
			"Cursor",
		]) {
			expect(html).toContain(label);
		}
	});

	it("cuatro clientes llevan la marca Sin probar; Claude Code no", () => {
		const html = render(agent);
		expect(html.match(/Sin probar/g)?.length).toBe(4);
	});

	it("la pestaña inicial es Claude Code, con su comando", () => {
		expect(render(agent)).toContain(
			"claude mcp add --transport http outreach-acme",
		);
	});

	it("la tarjeta de herramientas no tiene URL ni pestañas", () => {
		const html = render({
			kind: "tools",
			name: "Herramientas de tu empresa",
			description: "Próximamente: las herramientas de tu empresa.",
			soon: true,
		});

		expect(html).toContain("Herramientas de tu empresa");
		expect(html).toContain("Próximamente");
		expect(html).not.toContain("<input");
		expect(html).not.toContain("Claude Code");
	});
});
