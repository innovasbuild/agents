import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
	access: null as unknown,
	redirected: [] as string[],
}));

vi.mock("next/navigation", () => ({
	notFound: () => {
		throw new Error("NEXT_NOT_FOUND");
	},
	redirect: (url: string) => {
		state.redirected.push(url);
		throw new Error(`NEXT_REDIRECT:${url}`);
	},
}));
vi.mock("@/lib/tenants/resolve", () => ({
	prefetchEnabledAgentsWithAccess: () => {},
	resolveTenantAccess: async () => state.access,
}));
vi.mock("@/lib/tenants/enabled-agents", () => ({
	loadEnabledAgents: async () => ["chat"],
}));

import TenantLayout from "@/app/[tenant]/layout";

const access = (role: string, onboardingStep: string | null) => ({
	id: "t1",
	slug: "acme",
	displayName: "Acme",
	role,
	userId: "u1",
	defaultModel: "m",
	allowedModels: ["m"],
	brand: {},
	plan: "free",
	suspendedReason: null,
	trialEndsAt: null,
	onboardingStep,
});
const render = () =>
	TenantLayout({ children: null, params: Promise.resolve({ tenant: "acme" }) });

describe("TenantLayout · alta a medias", () => {
	beforeEach(() => {
		state.redirected = [];
	});

	it("admin con paso pendiente vuelve al paso", async () => {
		state.access = access("tenant_admin", "logo");
		await expect(render()).rejects.toThrow("NEXT_REDIRECT:/empezar/acme/logo");
	});

	it("sin paso pendiente no redirige", async () => {
		state.access = access("tenant_admin", null);
		await render();
		expect(state.redirected).toEqual([]);
	});

	it("miembro y platform_admin no se redirigen", async () => {
		for (const role of ["tenant_member", "platform_admin"]) {
			state.access = access(role, "logo");
			await render();
		}
		expect(state.redirected).toEqual([]);
	});

	it("el botón de invitar aparece solo para tenant_admin", async () => {
		const has = (node: unknown, name: string): boolean => {
			if (Array.isArray(node)) return node.some((n) => has(n, name));
			if (!node || typeof node !== "object") return false;
			const el = node as {
				type?: unknown;
				props?: { children?: unknown };
			};
			if (typeof el.type === "function" && el.type.name === name) return true;
			return has(el.props?.children, name);
		};
		const rendered = async (role: string) => {
			state.access = access(role, null);
			return render();
		};
		expect(has(await rendered("tenant_admin"), "InviteDialog")).toBe(true);
		expect(has(await rendered("tenant_member"), "InviteDialog")).toBe(false);
		expect(has(await rendered("platform_admin"), "InviteDialog")).toBe(false);
	});
});
