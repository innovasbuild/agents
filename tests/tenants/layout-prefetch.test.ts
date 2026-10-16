// Value: protects=el layout pide el prefetch de agentes antes de resolver el acceso y sigue dando 404 cuando no hay acceso.
// fails_when=el layout deja de pedir el prefetch (o lo pide después de resolver), o renderiza sin acceso.
// why_new=resolve-prefetch.test.ts prueba resolve, no quien lo pide; seam=none
import { describe, expect, it, vi } from "vitest";

const calls = vi.hoisted(() => ({
	order: [] as string[],
	access: null as unknown,
}));

vi.mock("next/navigation", () => ({
	notFound: () => {
		throw new Error("NEXT_NOT_FOUND");
	},
}));
vi.mock("@/lib/tenants/resolve", () => ({
	prefetchEnabledAgentsWithAccess: () => calls.order.push("prefetch"),
	resolveTenantAccess: async () => {
		calls.order.push("resolve");
		return calls.access;
	},
}));
vi.mock("@/lib/tenants/enabled-agents", () => ({
	loadEnabledAgents: async () => ["chat"],
}));

import TenantLayout from "@/app/[tenant]/layout";

const render = () =>
	TenantLayout({
		children: null,
		params: Promise.resolve({ tenant: "demo" }),
	});

describe("TenantLayout · prefetch de agentes", () => {
	it("pide el prefetch antes de resolver el acceso", async () => {
		calls.order = [];
		calls.access = {
			id: "t1",
			slug: "demo",
			displayName: "Demo",
			role: "tenant_member",
			userId: "u1",
			defaultModel: "m",
			allowedModels: ["m"],
			brand: {},
		};

		await render();

		expect(calls.order).toEqual(["prefetch", "resolve"]);
	});

	it("sin acceso responde 404", async () => {
		calls.order = [];
		calls.access = null;

		await expect(render()).rejects.toThrow("NEXT_NOT_FOUND");
	});
});
