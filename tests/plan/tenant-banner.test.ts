import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { bannerFor, TenantBanner } from "@/components/plan/tenant-banner";

const NOW = new Date("2026-01-12T12:00:00Z");
const inDays = (n: number) =>
	new Date(NOW.getTime() + n * 86_400_000).toISOString();
const base = {
	plan: "free" as const,
	suspendedReason: null,
	trialEndsAt: null as string | null,
	isAdmin: true,
	slug: "acme",
	now: NOW,
};
const html = (over: Partial<Parameters<typeof TenantBanner>[0]>) =>
	renderToStaticMarkup(createElement(TenantBanner, { ...base, ...over }));

describe("TenantBanner", () => {
	it("suspendida por trial vencido", () => {
		const out = html({ suspendedReason: "trial_vencido" });
		expect(out).toContain("Se terminaron los 3 meses del plan gratis");
		expect(out).toContain("Hablá con nosotros");
	});

	it("títulos de pago fallido y cancelado", () => {
		expect(html({ plan: "pago", suspendedReason: "pago_fallido" })).toContain(
			"No pudimos cobrar el último pago",
		);
		expect(html({ plan: "pago", suspendedReason: "cancelado" })).toContain(
			"La suscripción está cancelada",
		);
	});

	it("miembro suspendido: sin botón", () => {
		const out = html({ suspendedReason: "trial_vencido", isAdmin: false });
		expect(out).toContain("Se terminaron los 3 meses");
		expect(out).not.toContain("Hablá con nosotros");
	});

	it("free con 10 días: avisa con la fecha y 'Ver mi plan' solo al admin", () => {
		const out = html({ trialEndsAt: inDays(10) });
		expect(out).toContain("termina el 22 de enero");
		expect(out).toContain("Ver mi plan");
		expect(out).toContain("/acme/settings/plan");
		expect(html({ trialEndsAt: inDays(10), isAdmin: false })).not.toContain(
			"Ver mi plan",
		);
	});

	it("free con 20 días, enterprise y pago: nada", () => {
		expect(html({ trialEndsAt: inDays(20) })).toBe("");
		expect(html({ plan: "enterprise", trialEndsAt: inDays(5) })).toBe("");
		expect(html({ plan: "pago" })).toBe("");
		expect(bannerFor({ ...base, plan: "pago" })).toBeNull();
	});
});
