import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

type Result = { data: unknown; error: { message: string } | null };

const state: {
	tenant: unknown;
	agents: Result;
	brain: Result;
	settings: () => { publicUrl: string; issuer: string };
} = {
	tenant: null,
	agents: { data: [], error: null },
	brain: { data: [], error: null },
	settings: () => ({
		publicUrl: "https://app.test",
		issuer: "https://x/auth/v1",
	}),
};

// Consulta encadenable que resuelve al hacer await, como la de supabase-js.
function query(result: () => Result) {
	const q = {
		select: () => q,
		eq: () => q,
		order: () => q,
		limit: () => q,
		// biome-ignore lint/suspicious/noThenProperty: imita el builder de supabase-js
		then: (resolve: (value: Result) => unknown) =>
			Promise.resolve(result()).then(resolve),
	};
	return q;
}

vi.mock("@/lib/tenants/resolve", () => ({
	resolveTenantAccess: async () => state.tenant,
}));
vi.mock("@/lib/supabase/server", () => ({
	createServerSupabase: async () => ({
		from: (table: string) =>
			query(() => (table === "tenant_agents" ? state.agents : state.brain)),
	}),
}));
vi.mock("@/lib/brain/adapters/mcp-production", () => ({
	publicSettings: () => state.settings(),
}));
vi.mock("next/navigation", () => ({
	notFound: () => {
		throw new Error("NEXT_NOT_FOUND");
	},
}));

const { default: ConectarPage } = await import("@/app/[tenant]/conectar/page");

const tenant = (role: string) => ({
	id: "tenant-a",
	slug: "acme",
	displayName: "Acme",
	role,
	userId: "u1",
	defaultModel: "m",
	allowedModels: ["m"],
	brand: {},
});

const render = async () =>
	renderToStaticMarkup(
		await ConectarPage({ params: Promise.resolve({ tenant: "acme" }) }),
	);

const AVISO = "No se pudieron leer tus conexiones. Recargá la página.";

describe("página Conectar", () => {
	beforeEach(() => {
		state.tenant = tenant("tenant_member");
		state.agents = { data: [{ agent: "outreach" }], error: null };
		state.brain = { data: [{ id: "c1" }], error: null };
		state.settings = () => ({
			publicUrl: "https://app.test",
			issuer: "https://x/auth/v1",
		});
	});

	it("sin acceso al tenant da 404", async () => {
		state.tenant = null;
		await expect(render()).rejects.toThrow("NEXT_NOT_FOUND");
	});

	it("muestra el brain y el agente con las URLs de la empresa", async () => {
		const html = await render();

		expect(html).toContain("https://app.test/brain/acme/mcp");
		expect(html).toContain("https://app.test/eve/outreach/v1/mcp?tenant=acme");
		expect(html).toContain("Agente de outreach");
		expect(html).toContain("Herramientas de tu empresa");
	});

	it("un miembro y un administrador ven lo mismo", async () => {
		const comoMiembro = await render();
		state.tenant = tenant("tenant_admin");
		expect(await render()).toBe(comoMiembro);
	});

	it("un agente que no vino habilitado no aparece", async () => {
		state.agents = { data: [], error: null };
		const html = await render();

		expect(html).not.toContain("Agente de outreach");
		expect(html).toContain("https://app.test/brain/acme/mcp");
	});

	it("sin brain no hay tarjeta de brain", async () => {
		state.brain = { data: [], error: null };
		const html = await render();

		expect(html).not.toContain("/brain/acme/mcp");
		expect(html).toContain("Agente de outreach");
	});

	it("sin brain ni agentes avisa que no hay nada habilitado y deja la tarjeta de herramientas", async () => {
		state.agents = { data: [], error: null };
		state.brain = { data: [], error: null };
		const html = await render();

		expect(html).toContain(
			"Tu empresa todavía no tiene conexiones habilitadas.",
		);
		expect(html).toContain("Herramientas de tu empresa");
	});

	it("si falla la lectura de agentes muestra el aviso y ninguna tarjeta", async () => {
		state.agents = { data: null, error: { message: "timeout" } };
		const html = await render();

		expect(html).toContain(AVISO);
		expect(html).not.toContain("/brain/acme/mcp");
		expect(html).not.toContain("timeout");
	});

	it("si falla la lectura del brain muestra el aviso y ninguna tarjeta", async () => {
		state.brain = { data: null, error: { message: "timeout" } };
		const html = await render();

		expect(html).toContain(AVISO);
		expect(html).not.toContain("Agente de outreach");
	});

	it("si falta la URL pública muestra el aviso, no un error del servidor", async () => {
		state.settings = () => {
			throw new Error("faltan PUBLIC_APP_URL");
		};
		const error = vi.spyOn(console, "error").mockImplementation(() => {});
		const html = await render();

		expect(html).toContain(AVISO);
		expect(html).not.toContain("PUBLIC_APP_URL");
		error.mockRestore();
	});
});
