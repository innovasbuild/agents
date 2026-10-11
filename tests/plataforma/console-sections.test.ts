// tests/plataforma/console-sections.test.ts
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
	useRouter: () => ({ refresh: () => {} }),
}));
vi.mock("@/app/plataforma/[slug]/console-actions", () => ({
	setAgent: async () => ({ ok: true }),
	createBrain: async () => ({ ok: true }),
	setBrainCategories: async () => ({ ok: true }),
	bindConnection: async () => ({ ok: true }),
	setConnectionEnabled: async () => ({ ok: true }),
	removeConnection: async () => ({ ok: true }),
	verifyConnection: async () => ({ ok: true }),
	setBudget: async () => ({ ok: true }),
}));

const { AgentsSection } = await import(
	"@/app/plataforma/[slug]/console/agents-section"
);
const { BrainSection } = await import(
	"@/app/plataforma/[slug]/console/brain-section"
);
const { ConnectionsSection } = await import(
	"@/app/plataforma/[slug]/console/connections-section"
);
const { BindForm } = await import("@/app/plataforma/[slug]/console/bind-form");
const { BudgetsSection } = await import(
	"@/app/plataforma/[slug]/console/budgets-section"
);

const TENANT = "11111111-1111-4111-8111-111111111111";

describe("AgentsSection", () => {
	it("una fila por agente del catálogo, con interruptor y acceso al brain", () => {
		const html = renderToStaticMarkup(
			createElement(AgentsSection, {
				slug: "acme",
				tenantId: TENANT,
				agents: [{ agent: "outreach", enabled: true, brain: "read" }],
			}),
		);
		expect(html).toContain("Agente de outreach");
		expect(html).toMatch(/<input[^>]*type="checkbox"[^>]*checked/);
		expect(html).toMatch(/<option[^>]*value="read"[^>]*selected/);
		expect(html).toContain("Lectura y escritura");
	});

	it("un agente que la empresa no tiene aparece apagado", () => {
		const html = renderToStaticMarkup(
			createElement(AgentsSection, {
				slug: "acme",
				tenantId: TENANT,
				agents: [],
			}),
		);
		expect(html).toContain("Agente de outreach");
		expect(html).not.toMatch(/<input[^>]*type="checkbox"[^>]*checked/);
	});
});

describe("BrainSection", () => {
	it("sin brain ofrece crearlo", () => {
		const html = renderToStaticMarkup(
			createElement(BrainSection, {
				slug: "acme",
				tenantId: TENANT,
				brain: null,
			}),
		);
		expect(html).toContain("Crear brain");
	});

	it("con brain muestra proveedor, categorías y el link", () => {
		const html = renderToStaticMarkup(
			createElement(BrainSection, {
				slug: "acme",
				tenantId: TENANT,
				brain: {
					provider: "wiki",
					categories: ["empresa", "producto"],
					createdAt: "2026-10-10T00:00:00Z",
				},
			}),
		);
		expect(html).toContain("wiki");
		expect(html).toContain('value="empresa, producto"');
		expect(html).toContain("Guardar");
		expect(html).toContain('href="/acme/brain"');
		expect(html).not.toContain("Crear brain");
	});
});

describe("BrainSection deshabilitado", () => {
	it("un brain deshabilitado lo dice y no ofrece crearlo de nuevo", () => {
		const html = renderToStaticMarkup(
			createElement(BrainSection, {
				slug: "acme",
				tenantId: TENANT,
				brain: {
					provider: "wiki",
					categories: ["empresa"],
					createdAt: "2026-10-10T00:00:00Z",
					enabled: false,
				},
			}),
		);
		expect(html).toContain("Deshabilitado");
		expect(html).not.toContain("Crear brain");
	});
});

describe("ConnectionsSection", () => {
	const connection = {
		id: "22222222-2222-4222-8222-222222222222",
		capability: "leads",
		provider: "apollo",
		connectorUids: ["a1", "a2"],
		enabled: true,
		verifiedAt: null as string | null,
		verifiedName: null as string | null,
	};

	it("lista identificadores, estado y verificación, con sus botones", () => {
		const html = renderToStaticMarkup(
			createElement(ConnectionsSection, {
				slug: "acme",
				tenantId: TENANT,
				connections: [connection],
			}),
		);
		expect(html).toContain("apollo");
		expect(html).toContain("a1");
		expect(html).toContain("a2");
		expect(html).toContain("Sin verificar");
		expect(html).toContain("Verificar");
		expect(html).toContain("Deshabilitar");
		expect(html).toContain("Quitar");
	});

	it("una conexión verificada y deshabilitada lo dice", () => {
		const html = renderToStaticMarkup(
			createElement(ConnectionsSection, {
				slug: "acme",
				tenantId: TENANT,
				connections: [
					{
						...connection,
						enabled: false,
						verifiedAt: "2026-10-10T12:00:00Z",
						verifiedName: "Apollo Acme",
					},
				],
			}),
		);
		expect(html).toContain("Apollo Acme");
		expect(html).toContain("Habilitar");
		expect(html).not.toContain("Sin verificar");
	});

	it("sin conexiones lo dice", () => {
		expect(
			renderToStaticMarkup(
				createElement(ConnectionsSection, {
					slug: "acme",
					tenantId: TENANT,
					connections: [],
				}),
			),
		).toContain("Todavía no hay conectores");
	});
});

describe("BindForm", () => {
	it("ofrece los proveedores del catálogo salvo los de brain y avisa que acá no va la llave", () => {
		const html = renderToStaticMarkup(
			createElement(BindForm, { slug: "acme", tenantId: TENANT }),
		);
		expect(html).toContain('value="coldiq"');
		expect(html).toContain('value="hubspot"');
		expect(html).not.toContain('value="wiki"');
		expect(html).not.toContain('value="mcp"');
		expect(html).toContain("Acá nunca va la llave");
	});
});

describe("BindForm: varios identificadores", () => {
	it("solo apollo ofrece agregar otro; los demás tienen un único campo", () => {
		const coldiq = renderToStaticMarkup(
			createElement(BindForm, {
				slug: "acme",
				tenantId: TENANT,
				initialProvider: "coldiq",
			}),
		);
		const apollo = renderToStaticMarkup(
			createElement(BindForm, {
				slug: "acme",
				tenantId: TENANT,
				initialProvider: "apollo",
			}),
		);
		expect(coldiq).not.toContain("Agregar otro");
		expect(apollo).toContain("Agregar otro");
	});
});

describe("BudgetsSection", () => {
	it("una fila por recurso con su límite editable y lo gastado hoy", () => {
		const html = renderToStaticMarkup(
			createElement(BudgetsSection, {
				slug: "acme",
				tenantId: TENANT,
				budgets: [
					{ resource: "model_usd", dailyLimit: 2.5, spent: 0.4 },
					{ resource: "apollo_credits", dailyLimit: 0, spent: 0 },
				],
			}),
		);
		expect(html).toContain("Modelos de IA (USD)");
		expect(html).toMatch(/<input[^>]*value="2.5"/);
		expect(html).toContain("Gastado hoy: 0,40");
		expect(html).toContain(
			"Sin presupuesto: los procesos que lo usan no corren.",
		);
	});
});
