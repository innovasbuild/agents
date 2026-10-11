import { beforeEach, describe, expect, it, vi } from "vitest";

const state: {
	tenant: { id: string } | null;
	agents: string[] | null;
	brain: boolean;
} = { tenant: { id: "t1" }, agents: [], brain: true };

vi.mock("@/lib/tenants/resolve", () => ({
	resolveTenantAccess: async () => state.tenant,
}));
vi.mock("@/lib/tenants/enabled-agents", () => ({
	loadEnabledAgents: async () => state.agents,
	loadBrainEnabled: async () => state.brain,
}));
vi.mock("next/navigation", () => ({
	notFound: () => {
		throw new Error("NOT_FOUND");
	},
	redirect: (path: string) => {
		throw new Error(`REDIRECT ${path}`);
	},
}));

const { default: TenantHomePage } = await import("@/app/[tenant]/page");
const open = () =>
	TenantHomePage({ params: Promise.resolve({ tenant: "acme" }) });

beforeEach(() => {
	state.tenant = { id: "t1" };
	state.agents = [];
	state.brain = true;
});

describe("/<slug>", () => {
	it("sin agentes va al brain", async () => {
		await expect(open()).rejects.toThrow("REDIRECT /acme/brain");
	});

	it("con outreach va al chat", async () => {
		state.agents = ["outreach"];
		await expect(open()).rejects.toThrow("REDIRECT /acme/chat");
	});

	it("sin agentes ni brain va a Conectar", async () => {
		state.brain = false;
		await expect(open()).rejects.toThrow("REDIRECT /acme/conectar");
	});

	it("si no se pudieron leer los agentes, va al chat como siempre", async () => {
		state.agents = null;
		await expect(open()).rejects.toThrow("REDIRECT /acme/chat");
	});

	it("sin acceso da 404", async () => {
		state.tenant = null;
		await expect(open()).rejects.toThrow("NOT_FOUND");
	});
});
