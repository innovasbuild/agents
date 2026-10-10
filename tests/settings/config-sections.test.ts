import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
	useRouter: () => ({ refresh: () => {} }),
}));
vi.mock("@/app/[tenant]/settings/config-actions", () => ({
	saveExecutor: async () => ({ ok: true }),
	removeExecutor: async () => ({ ok: true }),
	saveApproval: async () => ({ ok: true }),
	toggleConnection: async () => ({ ok: true }),
}));

const { ExecutorsSection } = await import(
	"@/app/[tenant]/settings/config/executors-section"
);
const { ApprovalsSection } = await import(
	"@/app/[tenant]/settings/config/approvals-section"
);
const { ConnectionsSection } = await import(
	"@/app/[tenant]/settings/config/connections-section"
);

const executor = {
	userId: "u1",
	person: "Ana López",
	slug: "ana",
	displayName: "Ana López",
	title: "AE",
	linkedinUrl: "https://www.linkedin.com/in/ana",
	dailyQuota: 40,
	gmailAuthorizedAt: "2026-10-01T00:00:00Z",
	crmOwnerId: "777",
};

describe("ExecutorsSection", () => {
	it("muestra cada ejecutor con sus datos editables y su estado", () => {
		const html = renderToStaticMarkup(
			createElement(ExecutorsSection, {
				slug: "acme",
				executors: [executor],
				candidates: [],
			}),
		);
		expect(html).toContain("Ana López");
		expect(html).toMatch(/<input[^>]*value="ana"/);
		expect(html).toMatch(/<input[^>]*type="number"[^>]*value="40"/);
		expect(html).toMatch(/<input[^>]*max="200"/);
		expect(html).toContain("Gmail autorizado");
		expect(html).toContain("HubSpot vinculado");
		expect(html).toContain("Quitar");
		expect(html).not.toContain("executors:set");
	});

	it("avisa lo que le falta autorizar a un ejecutor", () => {
		const html = renderToStaticMarkup(
			createElement(ExecutorsSection, {
				slug: "acme",
				executors: [{ ...executor, gmailAuthorizedAt: null, crmOwnerId: null }],
				candidates: [],
			}),
		);
		expect(html).toContain("Falta autorizar Gmail");
		expect(html).toContain("Falta autorizar HubSpot");
	});

	it("ofrece agregar a un miembro que todavía no es ejecutor, con el slug sugerido", () => {
		const html = renderToStaticMarkup(
			createElement(ExecutorsSection, {
				slug: "acme",
				executors: [],
				candidates: [
					{ userId: "u2", person: "beto@acme.test", suggestedSlug: "beto" },
				],
			}),
		);
		expect(html).toContain("Agregar ejecutor");
		expect(html).toMatch(/<option[^>]*value="u2"[^>]*>beto@acme\.test/);
		expect(html).toMatch(/<input[^>]*value="beto"/);
		expect(html).toContain("Todavía no hay ejecutores");
	});

	it("sin miembros disponibles no ofrece agregar y dice por qué", () => {
		const html = renderToStaticMarkup(
			createElement(ExecutorsSection, {
				slug: "acme",
				executors: [executor],
				candidates: [],
			}),
		);
		expect(html).not.toContain("Agregar ejecutor");
		expect(html).toContain("Todos los miembros ya son ejecutores");
	});
});

describe("ApprovalsSection", () => {
	it("un selector por paso de nivel 2, con la política actual y su explicación", () => {
		const html = renderToStaticMarkup(
			createElement(ApprovalsSection, {
				slug: "acme",
				agents: [
					{
						agent: "outreach",
						name: "Agente de outreach",
						nodes: [{ node: "outreach/crm-record", policy: "once" }],
					},
				],
			}),
		);
		expect(html).toContain("Agente de outreach");
		expect(html).toContain("outreach/crm-record");
		expect(html).toMatch(/<option[^>]*value="once"[^>]*selected/);
		expect(html).toContain("Siempre pedir");
		expect(html).toContain("Sin pedir");
		expect(html).toContain("Pide aprobación la primera vez");
	});

	it("sin pasos que configurar lo dice", () => {
		expect(
			renderToStaticMarkup(
				createElement(ApprovalsSection, { slug: "acme", agents: [] }),
			),
		).toContain("No hay pasos que requieran una política");
	});
});

describe("ConnectionsSection", () => {
	const base = {
		id: "c1",
		capability: "leads",
		provider: "coldiq",
		enabled: true,
		lockedByPlatform: false,
	};

	it("un conector habilitado se puede deshabilitar; uno deshabilitado por el cliente, habilitar", () => {
		const on = renderToStaticMarkup(
			createElement(ConnectionsSection, { slug: "acme", connections: [base] }),
		);
		expect(on).toContain("coldiq");
		expect(on).toContain("Deshabilitar");

		const off = renderToStaticMarkup(
			createElement(ConnectionsSection, {
				slug: "acme",
				connections: [{ ...base, enabled: false }],
			}),
		);
		expect(off).toContain("Habilitar");
		expect(off).not.toContain("Deshabilitado por INNOV.AS");
	});

	it("uno bloqueado por plataforma no tiene botón y lo explica", () => {
		const html = renderToStaticMarkup(
			createElement(ConnectionsSection, {
				slug: "acme",
				connections: [{ ...base, enabled: false, lockedByPlatform: true }],
			}),
		);
		expect(html).toContain("Deshabilitado por INNOV.AS");
		expect(html).not.toContain("<button");
	});

	it("el brain no tiene botón", () => {
		const html = renderToStaticMarkup(
			createElement(ConnectionsSection, {
				slug: "acme",
				connections: [
					{
						id: "b",
						capability: "brain",
						provider: "wiki",
						enabled: true,
						lockedByPlatform: false,
					},
				],
			}),
		);
		expect(html).toContain("wiki");
		expect(html).toContain("Lo maneja INNOV.AS");
		expect(html).not.toContain("<button");
	});

	it("nunca muestra el identificador del conector", () => {
		const html = renderToStaticMarkup(
			createElement(ConnectionsSection, {
				slug: "acme",
				connections: [
					{ ...base, connectorUid: "acme-coldiq-secreto" } as never,
				],
			}),
		);
		expect(html).not.toContain("acme-coldiq-secreto");
	});

	it("sin conectores lo dice", () => {
		expect(
			renderToStaticMarkup(
				createElement(ConnectionsSection, { slug: "acme", connections: [] }),
			),
		).toContain("Todavía no hay conexiones configuradas");
	});
});
