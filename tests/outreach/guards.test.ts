import { describe, expect, it } from "vitest";
import { canTouch, claimStatus, crmMatch } from "@/lib/outreach/guards";

const now = new Date("2026-09-15T12:00:00Z");
const daysAgo = (n: number) => new Date(now.getTime() - n * 86_400_000);
const base = { executorUserId: "ana", executorCrmOwnerId: "crm-ana", now };

describe("claimStatus", () => {
	it("libre, propio o ajeno según el owner de la base cuando el CRM no dice nada reciente", () => {
		expect(
			claimStatus({ ...base, ownerUserId: null, crmAuthorship: null }),
		).toBe("libre");
		expect(
			claimStatus({ ...base, ownerUserId: "ana", crmAuthorship: null }),
		).toBe("propio");
		expect(
			claimStatus({ ...base, ownerUserId: "beto", crmAuthorship: null }),
		).toBe("ajeno");
		expect(
			claimStatus({
				...base,
				ownerUserId: "beto",
				crmAuthorship: { ownerId: "crm-ana", at: daysAgo(120) },
			}),
		).toBe("ajeno");
	});
	it("la autoría reciente del CRM gana sobre la base", () => {
		expect(
			claimStatus({
				...base,
				ownerUserId: "ana",
				crmAuthorship: { ownerId: "crm-beto", at: daysAgo(30) },
			}),
		).toBe("ajeno");
		expect(
			claimStatus({
				...base,
				ownerUserId: "beto",
				crmAuthorship: { ownerId: "crm-ana", at: daysAgo(30) },
			}),
		).toBe("propio");
		expect(
			claimStatus({
				...base,
				ownerUserId: null,
				crmAuthorship: { ownerId: "crm-beto", at: daysAgo(89) },
			}),
		).toBe("ajeno");
	});
	it("un ejecutor sin owner en el CRM no puede probar una autoría reciente", () => {
		expect(
			claimStatus({
				...base,
				executorCrmOwnerId: null,
				ownerUserId: null,
				crmAuthorship: { ownerId: "crm-ana", at: daysAgo(1) },
			}),
		).toBe("ajeno");
	});
});

describe("crmMatch", () => {
	const candidates = [
		{ id: "1", contactKey: null, email: "laura@acme.test", linkedinSlugs: [] },
		{
			id: "2",
			contactKey: "em:laura@acme.test",
			email: null,
			linkedinSlugs: [],
		},
		{ id: "3", contactKey: null, email: null, linkedinSlugs: ["laura-gomez"] },
	];
	it("prioriza contact_key, después email, después LinkedIn", () => {
		expect(
			crmMatch(candidates, {
				contactKey: "em:laura@acme.test",
				email: "laura@acme.test",
				linkedinSlug: null,
			})?.id,
		).toBe("2");
		expect(
			crmMatch(candidates, {
				contactKey: "em:otra@acme.test",
				email: "laura@acme.test",
				linkedinSlug: null,
			})?.id,
		).toBe("1");
		expect(
			crmMatch(candidates, {
				contactKey: "li:laura-gomez",
				email: null,
				linkedinSlug: "laura-gomez",
			})?.id,
		).toBe("3");
		expect(
			crmMatch(candidates, {
				contactKey: "em:nadie@acme.test",
				email: "nadie@acme.test",
				linkedinSlug: null,
			}),
		).toBeNull();
	});
	it("el email matchea sin importar mayúsculas de ningún lado", () => {
		expect(
			crmMatch(
				[
					{
						id: "9",
						contactKey: null,
						email: "Laura@Acme.test",
						linkedinSlugs: [],
					},
				],
				{
					contactKey: "em:x",
					email: "LAURA@acme.TEST",
					linkedinSlug: null,
				},
			)?.id,
		).toBe("9");
	});
});

describe("canTouch", () => {
	const ok = {
		now,
		expiresAt: new Date(now.getTime() + 86_400_000),
		touches: 0,
		sentTodayToRecipient: false,
		sentTodayByExecutor: 2,
		dailyQuota: 30,
		lastSentToRecipientOutsideThreadAt: null,
	};
	it("deja pasar una pieza en regla", () => {
		expect(canTouch(ok)).toEqual({ ok: true });
	});
	it("chequea en el orden del canon", () => {
		expect(
			canTouch({ ...ok, expiresAt: daysAgo(1), sentTodayToRecipient: true }),
		).toEqual({ ok: false, reason: "vencida", transient: false });
		expect(
			canTouch({ ...ok, sentTodayToRecipient: true, sentTodayByExecutor: 30 }),
		).toEqual({ ok: false, reason: "un_toque_por_dia", transient: true });
		expect(canTouch({ ...ok, sentTodayByExecutor: 30, touches: 3 })).toEqual({
			ok: false,
			reason: "cupo_diario",
			transient: true,
		});
		expect(
			canTouch({
				...ok,
				touches: 3,
				lastSentToRecipientOutsideThreadAt: daysAgo(2),
			}),
		).toEqual({ ok: false, reason: "max_toques", transient: false });
		expect(
			canTouch({ ...ok, lastSentToRecipientOutsideThreadAt: daysAgo(9) }),
		).toEqual({ ok: false, reason: "buzon", transient: false });
	});
	it("el guard de buzón mira solo los últimos 10 días", () => {
		expect(
			canTouch({ ...ok, lastSentToRecipientOutsideThreadAt: daysAgo(11) }),
		).toEqual({ ok: true });
	});
});
