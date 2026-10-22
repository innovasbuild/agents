import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = {
	role: "tenant_admin" as string | null,
	plan: {
		plan: "free",
		suspendedReason: null,
		trialEndsAt: "2027-01-22T10:00:00Z",
		aiMonthlyLimitUsd: null,
	} as Record<string, unknown>,
	counts: { users: 2, pendingInvitations: 1, publishedSkills: 1 },
	spend: 1.2,
	spendSince: [] as Date[],
};

vi.mock("@/lib/tenants/resolve", () => ({
	resolveTenantAccess: async () =>
		state.role === null
			? null
			: { id: "t1", slug: "acme", displayName: "Acme", role: state.role },
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({}) }));
vi.mock("@/lib/plans/store", () => ({
	createPlanStore: () => ({
		tenantPlan: async () => state.plan,
		counts: async () => state.counts,
		monthSpendUsd: async (_id: string, since: Date) => {
			state.spendSince.push(since);
			return state.spend;
		},
	}),
}));
vi.mock("@/app/[tenant]/settings/perfil-actions", () => ({
	saveAiMonthlyLimit: async () => ({ ok: true }),
}));
vi.mock("next/navigation", () => ({
	notFound: () => {
		throw new Error("NEXT_NOT_FOUND");
	},
}));

const { default: PlanPage } = await import("@/app/[tenant]/settings/plan/page");

const render = async () =>
	renderToStaticMarkup(
		await PlanPage({ params: Promise.resolve({ tenant: "acme" }) }),
	);

beforeEach(() => {
	vi.useFakeTimers();
	vi.setSystemTime(new Date("2026-10-13T15:00:00Z"));
	state.role = "tenant_admin";
	state.plan = {
		plan: "free",
		suspendedReason: null,
		trialEndsAt: "2027-01-22T10:00:00Z",
		aiMonthlyLimitUsd: null,
	};
	state.counts = { users: 2, pendingInvitations: 1, publishedSkills: 1 };
	state.spend = 1.2;
	state.spendSince = [];
});

describe("pestaña Plan", () => {
	it("un miembro recibe 404", async () => {
		state.role = "tenant_member";
		await expect(render()).rejects.toThrow("NEXT_NOT_FOUND");
	});

	it("sin acceso, 404", async () => {
		state.role = null;
		await expect(render()).rejects.toThrow("NEXT_NOT_FOUND");
	});

	it("free: filas con tope, invitaciones pendientes, fecha y botón", async () => {
		const html = await render();
		expect(html).toContain("Free");
		expect(html).toContain("3 de 3");
		expect(html).toContain("2 activos y 1 invitación pendiente");
		expect(html).toContain("1 de 5");
		expect(html).toContain("USD 1,20 de 5");
		expect(html).toContain("22 de enero de 2027");
		expect(html).toContain("Hablá con nosotros");
		expect(html).toContain("mailto:hola@innov.as");
		expect(state.spendSince[0]?.toISOString()).toBe("2026-10-01T00:00:00.000Z");
	});

	it("free con el trial por vencer avisa los días", async () => {
		state.plan = { ...state.plan, trialEndsAt: "2026-10-20T10:00:00Z" };
		expect(await render()).toContain("Faltan 7 días");
	});

	it("suspendida muestra el aviso", async () => {
		state.plan = { ...state.plan, suspendedReason: "trial_vencido" };
		expect(await render()).toContain("Se terminaron los 3 meses");
	});

	it("enterprise: sin topes y con link a Gasto", async () => {
		state.plan = { ...state.plan, plan: "enterprise", trialEndsAt: null };
		const html = await render();
		expect(html).toContain("Enterprise");
		expect(html).not.toContain("de 3");
		expect(html).not.toContain("Hablá con nosotros");
		expect(html).toContain("/acme/settings/gasto");
	});

	it("pago: gasto del mes y formulario del tope", async () => {
		state.plan = { ...state.plan, plan: "pago", trialEndsAt: null };
		const html = await render();
		expect(html).toContain("Pago");
		expect(html).toContain("USD 1,20 este mes");
		expect(html).toContain("Tope mensual");
		expect(html).not.toContain("de 3");
		expect(html).not.toContain("Hablá con nosotros");
	});
});
