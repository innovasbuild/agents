// Value: protects=las reglas de un miembro se leen junto con el binding del brain sin perder el cierre: con brain wiki una falla de reglas corta la página, sin brain no la rompe y el admin nunca las pide.
// fails_when=la lectura de reglas vuelve a esperar al binding, o su falla se traga cuando hay brain, o rompe un tenant sin brain.
// why_new=editor-access.test.ts no controla el orden ni los errores de las dos lecturas; seam=none
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
	access: null as unknown,
	binding: null as unknown,
	order: [] as string[],
	bindingGate: null as Promise<void> | null,
	rulesFail: false,
}));

vi.mock("react", async (original) => ({
	...(await original<typeof import("react")>()),
	cache: <T>(fn: T) => fn,
}));

vi.mock("@/lib/tenants/resolve", () => ({
	resolveTenantAccess: vi.fn(async () => state.access),
}));

vi.mock("@/lib/connectors/bindings", () => ({
	loadTenantBindings: vi.fn(async () => {
		state.order.push("binding:start");
		await state.bindingGate;
		state.order.push("binding:end");
		return state.binding ? [state.binding] : [];
	}),
}));

vi.mock("@/lib/brain/adapters/access-rules", () => ({
	accessRulesStore: () => ({
		load: async () => {
			state.order.push("rules:start");
			if (state.rulesFail) throw new Error("reglas caídas");
			return [];
		},
	}),
}));

vi.mock("@/lib/brain/adapters/provider", () => ({
	getBrainProvider: () => ({
		search: vi.fn(),
		read: vi.fn(),
		list: vi.fn(async () => []),
		history: vi.fn(),
		upsert: vi.fn(),
	}),
}));

import { loadEditorContext } from "@/lib/brain/adapters/editor";

const wikiBinding = {
	id: "b1",
	tenantId: "tenant-a",
	capability: "brain",
	provider: "wiki",
	connectorUid: null,
	config: { categories: ["comercial"], requiredFrontmatter: [], search: "fts" },
};

const tenantAccess = (role: string) => ({
	id: "tenant-a",
	slug: "acme",
	displayName: "Acme",
	role,
	userId: "ana",
	defaultModel: "m",
	allowedModels: ["m"],
	brand: {},
});

describe("loadEditorContext · reglas en paralelo con el binding", () => {
	beforeEach(() => {
		state.order = [];
		state.binding = wikiBinding;
		state.bindingGate = null;
		state.rulesFail = false;
		state.access = tenantAccess("tenant_member");
	});

	it("un miembro arranca las reglas sin esperar a que termine el binding", async () => {
		let release!: () => void;
		state.bindingGate = new Promise<void>((resolve) => {
			release = resolve;
		});

		const pending = loadEditorContext("acme");
		await vi.waitFor(() => expect(state.order).toContain("rules:start"));
		// El binding sigue abierto y las reglas ya salieron.
		expect(state.order).not.toContain("binding:end");

		release();
		const ctx = await pending;
		expect(ctx?.kind).toBe("ok");
	});

	it("con brain wiki, si las reglas fallan la página corta", async () => {
		state.rulesFail = true;

		await expect(loadEditorContext("acme")).rejects.toThrow("reglas caídas");
	});

	it("sin brain, una falla de reglas no rompe la pantalla", async () => {
		state.rulesFail = true;
		state.binding = null;

		const ctx = await loadEditorContext("acme");

		expect(ctx?.kind).toBe("no-brain");
	});

	it("con un brain externo no depende de las reglas", async () => {
		state.rulesFail = true;
		state.binding = {
			id: "b2",
			tenantId: "tenant-a",
			capability: "brain",
			provider: "mcp",
			connectorUid: "uid-1",
			config: {
				url: "https://brain.example.com/mcp",
				categories: ["comercial"],
			},
		};

		const ctx = await loadEditorContext("acme");

		expect(ctx?.kind).toBe("external");
	});

	it("un administrador nunca las pide", async () => {
		state.access = tenantAccess("tenant_admin");

		const ctx = await loadEditorContext("acme");

		expect(ctx?.kind).toBe("ok");
		expect(state.order).not.toContain("rules:start");
	});

	it("sin acceso al tenant no lee nada", async () => {
		state.access = null;

		await expect(loadEditorContext("acme")).resolves.toBeNull();
		expect(state.order).toEqual([]);
	});
});
