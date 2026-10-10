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

const {
	AddExecutor,
	ExecutorsSection,
	initialDraftFor,
	parseDraft,
	resolveCandidate,
} = await import("@/app/[tenant]/settings/config/executors-section");
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

describe("alta de ejecutores: la persona elegida siempre es una que sigue disponible", () => {
	const a = { userId: "ua", person: "Ana", suggestedSlug: "ana" };
	const b = { userId: "ub", person: "Beto", suggestedSlug: "beto" };

	it("resolveCandidate: si la elegida ya no está, cae a la primera disponible", () => {
		expect(resolveCandidate([a, b], "ub")).toBe(b);
		expect(resolveCandidate([b], "ua")).toBe(b);
		expect(resolveCandidate([], "ua")).toBeUndefined();
	});

	it("initialDraftFor: arranca limpio y con el slug sugerido", () => {
		expect(initialDraftFor(b)).toEqual({
			slug: "beto",
			displayName: "",
			title: "",
			linkedinUrl: "",
			dailyQuota: "30",
		});
		expect(initialDraftFor(undefined).slug).toBe("");
	});

	it("tras agregar a A, el formulario se remonta (otra key) y ofrece a B", () => {
		const tree = (candidates: (typeof a)[]) =>
			// ExecutorsSection no usa hooks: se la puede llamar como función.
			(
				ExecutorsSection({
					slug: "acme",
					executors: [executor],
					candidates,
				}) as never as {
					props: { children: { type: unknown; key: string | null }[] };
				}
			).props.children[1];
		const before = tree([a, b]);
		const after = tree([b]);
		expect(after.type).toBe(AddExecutor);
		expect(after.key).not.toBe(before.key);

		const html = renderToStaticMarkup(
			createElement(AddExecutor, { slug: "acme", candidates: [b] }),
		);
		expect(html).toMatch(/<option[^>]*value="ub"[^>]*selected/);
		expect(html).not.toContain('value="ua"');
		expect(html).toMatch(/<input[^>]*value="beto"/);
	});

	it("el slug y el cupo se validan en el navegador con la misma regla que la base", () => {
		const html = renderToStaticMarkup(
			createElement(AddExecutor, { slug: "acme", candidates: [a] }),
		);
		expect(html).toMatch(/<input[^>]*pattern="\[a-z\]\[a-z0-9\\-\]\{0,30\}"/);
		expect(html).toMatch(
			/<input[^>]*id="nuevo-slug"[^>]*required|<input[^>]*required[^>]*id="nuevo-slug"/,
		);
		expect(html).toMatch(
			/<input[^>]*id="nuevo-dailyQuota"[^>]*required|<input[^>]*required[^>]*id="nuevo-dailyQuota"/,
		);
	});

	it("parseDraft: un cupo vacío o inválido no se convierte en 0", () => {
		const draft = initialDraftFor(a);
		expect(parseDraft({ ...draft, dailyQuota: "" })).toEqual({
			ok: false,
			message: expect.any(String),
		});
		expect(parseDraft({ ...draft, dailyQuota: "abc" }).ok).toBe(false);
		expect(parseDraft({ ...draft, dailyQuota: "0" })).toMatchObject({
			ok: true,
			input: { dailyQuota: 0 },
		});
		expect(parseDraft({ ...draft, dailyQuota: "40" })).toMatchObject({
			ok: true,
			input: { dailyQuota: 40 },
		});
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
