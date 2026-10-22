import { describe, expect, it } from "vitest";
import {
	canInvite,
	canPublishSkill,
	limitMessage,
	monthStartUtc,
	type TenantCounts,
	type TenantPlan,
	trialWarning,
} from "@/lib/plans/limits";

const free: TenantPlan = {
	plan: "free",
	suspendedReason: null,
	trialEndsAt: null,
	aiMonthlyLimitUsd: null,
};
const counts = (c: Partial<TenantCounts>): TenantCounts => ({
	users: 0,
	pendingInvitations: 0,
	publishedSkills: 0,
	...c,
});

describe("canInvite", () => {
	it("free con 3 usuarios corta", () => {
		expect(canInvite(free, counts({ users: 3 }))).toBe("limit:users");
	});
	it("las invitaciones pendientes no cuentan", () => {
		expect(
			canInvite(free, counts({ users: 2, pendingInvitations: 5 })),
		).toBeNull();
	});
	it("pago no tiene tope", () => {
		expect(
			canInvite({ ...free, plan: "pago" }, counts({ users: 50 })),
		).toBeNull();
	});
	it("suspendida corta primero", () => {
		expect(
			canInvite(
				{ ...free, suspendedReason: "trial_vencido" },
				counts({ users: 0 }),
			),
		).toBe("suspended:trial_vencido");
	});
});

describe("canPublishSkill", () => {
	it("free con 5 corta", () => {
		expect(canPublishSkill(free, counts({ publishedSkills: 5 }))).toBe(
			"limit:skills",
		);
	});
	it("free con 4 pasa", () => {
		expect(canPublishSkill(free, counts({ publishedSkills: 4 }))).toBeNull();
	});
});

describe("trialWarning", () => {
	const now = new Date("2026-10-22T12:00:00Z");
	const ends = (days: number) =>
		new Date(now.getTime() + days * 86_400_000).toISOString();
	it("13 días avisa", () => {
		expect(trialWarning({ ...free, trialEndsAt: ends(13) }, now)).toEqual({
			daysLeft: 13,
		});
	});
	it("15 días no avisa", () => {
		expect(trialWarning({ ...free, trialEndsAt: ends(15) }, now)).toBeNull();
	});
	it("enterprise no avisa", () => {
		expect(
			trialWarning({ ...free, plan: "enterprise", trialEndsAt: ends(3) }, now),
		).toBeNull();
	});
	it("vencido no avisa", () => {
		expect(trialWarning({ ...free, trialEndsAt: ends(-1) }, now)).toBeNull();
	});
});

describe("monthStartUtc", () => {
	it("primer día del mes en UTC", () => {
		expect(monthStartUtc(new Date("2026-10-22T03:00:00-03:00"))).toEqual(
			new Date("2026-10-01T00:00:00Z"),
		);
	});
});

describe("limitMessage", () => {
	const cases = [
		["limit:users", "Tu equipo creció", ["3 personas", "escribinos"]],
		[
			"limit:skills",
			"Llegaste a las 5 skills del plan gratis",
			["sexta", "escribinos"],
		],
		[
			"limit:ai_credit",
			"Se terminó el crédito de IA de este mes",
			["USD 5", "El brain y las páginas siguen disponibles", "escribinos"],
		],
		[
			"suspended:trial_vencido",
			"Se terminaron los 3 meses del plan gratis",
			["puede leer todo", "Escribinos"],
		],
		[
			"suspended:pago_fallido",
			"No pudimos cobrar el último pago",
			["puede leer todo", "Escribinos"],
		],
		[
			"suspended:cancelado",
			"La suscripción está cancelada",
			["puede leer todo", "Escribinos"],
		],
	] as const;
	it.each(cases)("%s", (reason, title, phrases) => {
		const m = limitMessage(reason);
		expect(m.title).toBe(title);
		for (const p of phrases) expect(m.body).toContain(p);
	});
});
