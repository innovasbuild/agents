// tests/settings/outreach-sections.test.ts
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
	useRouter: () => ({ refresh: () => {} }),
}));
vi.mock("@/app/[tenant]/settings/outreach/actions", () => ({
	saveListValue: async () => ({ ok: true }),
	saveOutreachConfig: async () => ({ ok: true }),
	saveWorkflow: async () => ({ ok: true }),
	rereadMarco: async () => ({ ok: true }),
}));

const { ListsSection } = await import(
	"@/app/[tenant]/settings/outreach/lists-section"
);
const { OutreachConfigForm } = await import(
	"@/app/[tenant]/settings/outreach/config-form"
);
const { WorkflowsSection } = await import(
	"@/app/[tenant]/settings/outreach/workflows-section"
);
const { BudgetSummary, IcpSummary, MarcoSummary } = await import(
	"@/app/[tenant]/settings/outreach/readonly-sections"
);

const render = (element: ReturnType<typeof createElement>) =>
	renderToStaticMarkup(element);

describe("ListsSection", () => {
	const values = [
		{
			kind: "segmento" as const,
			value: "mid",
			label: "Mid market",
			active: true,
			defaultHook: null,
		},
		{
			kind: "segmento" as const,
			value: "viejo",
			label: "Viejo",
			active: false,
			defaultHook: null,
		},
		{
			kind: "idioma" as const,
			value: "es_ar",
			label: "Rioplatense",
			active: true,
			defaultHook: null,
		},
	];

	it("muestra segmentos e idiomas con su estado y el alta", () => {
		const html = render(
			createElement(ListsSection, {
				slug: "acme",
				values,
				idiomas: ["es_ar", "es_es"],
			}),
		);
		expect(html).toContain("Mid market");
		expect(html).toContain("Viejo");
		expect(html).toContain("Desactivado");
		expect(html).toContain("Agregar segmento");
		// Solo se ofrecen los idiomas que faltan.
		expect(html).toMatch(/<option[^>]*value="es_es"/);
		expect(html).not.toMatch(/<option[^>]*value="es_ar"/);
	});
});

describe("OutreachConfigForm", () => {
	it("precarga los datos y ofrece solo los modelos permitidos", () => {
		const html = render(
			createElement(OutreachConfigForm, {
				slug: "acme",
				initial: {
					timezone: "America/Montevideo",
					bcc: "bcc@acme.test",
					dealPipeline: "default",
					dealStage: "123",
					companyName: "Acme",
					companyUrl: "https://acme.test",
					models: { draft_msg1: "anthropic/claude-sonnet-5" },
				},
				allowedModels: ["anthropic/claude-sonnet-5"],
				defaults: { draft_msg1: "anthropic/claude-opus-5" },
			}),
		);
		expect(html).toMatch(/<input[^>]*value="America\/Montevideo"/);
		expect(html).toMatch(/<input[^>]*value="bcc@acme.test"/);
		expect(html).toContain("anthropic/claude-sonnet-5");
		expect(html).toContain("El de la plataforma (anthropic/claude-opus-5)");
	});
});

describe("WorkflowsSection", () => {
	const row = {
		workflow: "target-search",
		enabled: true,
		cadenceMinutes: 60,
		itemsPerTick: 2,
		maxItemsPerTick: 2,
		lastRunAt: null,
		resources: ["apollo_credits"],
		unfunded: ["apollo_credits"],
	};

	it("avisa cuando un workflow encendido no tiene presupuesto", () => {
		const html = render(
			createElement(WorkflowsSection, { slug: "acme", workflows: [row] }),
		);
		expect(html).toContain("target-search");
		expect(html).toContain(
			"No va a correr: INNOV.AS todavía no cargó presupuesto de Créditos de búsqueda.",
		);
		expect(html).toMatch(/<input[^>]*max="2"/);
		expect(html).toContain("Todavía no corrió");
	});

	it("con presupuesto no avisa", () => {
		const html = render(
			createElement(WorkflowsSection, {
				slug: "acme",
				workflows: [{ ...row, unfunded: [] }],
			}),
		);
		expect(html).not.toContain("No va a correr");
	});
});

describe("secciones de solo lectura", () => {
	it("ICP: muestra los niveles o el motivo, con link al brain", () => {
		const ok = render(
			createElement(IcpSummary, {
				slug: "acme",
				icp: {
					ok: true,
					value: {
						encaje_empresa: ["No encaja: afuera", "Encaja: adentro"],
						rol_decisor: ["Sin relación", "Decide"],
						excluir: "Es competidora",
					},
				},
			}),
		);
		expect(ok).toContain("Encaja: adentro");
		expect(ok).toContain('href="/acme/brain"');

		const missing = render(
			createElement(IcpSummary, {
				slug: "acme",
				icp: { ok: false, reason: "falta", errors: [] },
			}),
		);
		expect(missing).toContain("Todavía no hay un ICP");

		const invalid = render(
			createElement(IcpSummary, {
				slug: "acme",
				icp: {
					ok: false,
					reason: "invalido",
					errors: ["comercial/icp, línea 2: corto"],
				},
			}),
		);
		expect(invalid).toContain("comercial/icp, línea 2: corto");
	});

	it("marco: lista activos, hook por defecto y el fallo del último reflejo", () => {
		const html = render(
			createElement(MarcoSummary, {
				slug: "acme",
				values: [
					{
						kind: "hook" as const,
						value: "h_uno",
						label: "Hook uno",
						active: true,
						defaultHook: null,
					},
					{
						kind: "hook" as const,
						value: "h_viejo",
						label: "Viejo",
						active: false,
						defaultHook: null,
					},
					{
						kind: "vector" as const,
						value: "v_uno",
						label: "Vector",
						active: true,
						defaultHook: "h_uno",
					},
				],
				lastFailure: { at: "2026-10-10T12:00:00Z", errors: ["a, línea 2: x"] },
			}),
		);
		expect(html).toContain("Hook uno");
		expect(html).not.toContain("Viejo");
		expect(html).toContain("h_uno");
		expect(html).toContain("a, línea 2: x");
		expect(html).toContain("Releer del brain");
	});

	it("presupuesto: límite y gastado por recurso", () => {
		const html = render(
			createElement(BudgetSummary, {
				budgets: [{ resource: "model_usd", dailyLimit: 2.5, spent: 0.4 }],
			}),
		);
		expect(html).toContain("Modelos de IA (USD)");
		expect(html).toContain("0,40");
		expect(html).toContain("2,50");
	});
});

describe("fixes de la ronda 1", () => {
	const ran = {
		workflow: "target-search",
		enabled: true,
		cadenceMinutes: 60,
		itemsPerTick: 2,
		maxItemsPerTick: 2,
		lastRunAt: "2026-10-10T12:30:00Z",
		resources: ["apollo_credits"],
		unfunded: [],
	};

	it("la última corrida sale con zona fija, igual en cualquier TZ del proceso", () => {
		const html = render(
			createElement(WorkflowsSection, { slug: "acme", workflows: [ran] }),
		);
		expect(html).toContain("Última corrida: 10/10/26, 9:30 a. m.");
		const utc = render(
			createElement(WorkflowsSection, {
				slug: "acme",
				workflows: [ran],
				timezone: "UTC",
			}),
		);
		expect(utc).toContain("Última corrida: 10/10/26, 12:30 p. m.");
	});

	it("un modelo guardado que ya no está permitido no se manda", () => {
		const html = render(
			createElement(OutreachConfigForm, {
				slug: "acme",
				initial: {
					timezone: "UTC",
					bcc: "",
					dealPipeline: "",
					dealStage: "",
					companyName: "",
					companyUrl: "",
					models: { draft_msg1: "anthropic/viejo" },
				},
				allowedModels: ["anthropic/claude-sonnet-5"],
				defaults: {},
			}),
		);
		expect(html).toMatch(/<option[^>]*value=""[^>]*selected/);
		expect(html).not.toMatch(
			/<option[^>]*value="anthropic\/claude-sonnet-5"[^>]*selected/,
		);
		expect(html).not.toContain("anthropic/viejo");
	});

	it("sin brain no ofrece el link al brain en el ICP", () => {
		const html = render(
			createElement(IcpSummary, {
				slug: "acme",
				icp: { ok: false, reason: "sin_brain", errors: [] },
			}),
		);
		expect(html).not.toContain("/acme/brain");
	});
});
