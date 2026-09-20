import { describe, expect, it } from "vitest";
import { planReconcile } from "@/lib/outreach/services/reconcile";

const NOW = new Date("2026-09-19T12:00:00Z");

const item = (over: Record<string, unknown> = {}) =>
	({
		id: "q1",
		status: "approved",
		approvedAt: "2026-09-19T11:00:00Z",
		gmailMessageId: null,
		gmailThreadId: null,
		...over,
	}) as never;

describe("planReconcile", () => {
	it("confirma la pieza cuando el mensaje aparece en enviados", () => {
		const verdict = planReconcile({
			item: item(),
			found: { id: "m1", threadId: "t1" },
			now: NOW,
		});

		expect(verdict).toEqual({
			action: "confirmar",
			gmailMessageId: "m1",
			gmailThreadId: "t1",
		});
	});

	it("si no aparece, la deja trabada: nunca reencola", () => {
		const verdict = planReconcile({ item: item(), found: null, now: NOW });

		expect(verdict.action).toBe("dejar_trabada");
	});

	it("una pieza vieja que no aparece sigue trabada, no se reintenta", () => {
		const verdict = planReconcile({
			item: item({ approvedAt: "2026-09-01T00:00:00Z" }),
			found: null,
			now: NOW,
		});

		expect(verdict.action).toBe("dejar_trabada");
	});

	it("el motivo de una trabada vieja dice que hay que revisarla a mano", () => {
		const verdict = planReconcile({
			item: item({ approvedAt: "2026-09-01T00:00:00Z" }),
			found: null,
			now: NOW,
		});

		if (verdict.action !== "dejar_trabada")
			throw new Error("verdict inesperado");
		expect(verdict.motivo).toMatch(/mano|revisar/i);
	});

	it("el motivo de una trabada menciona hace cuánto tiempo está así", () => {
		// approvedAt 2026-09-19T11:00:00Z, now 2026-09-19T12:00:00Z → 1 hora.
		const verdict = planReconcile({ item: item(), found: null, now: NOW });

		if (verdict.action !== "dejar_trabada")
			throw new Error("verdict inesperado");
		expect(verdict.motivo).toMatch(/hora|hs|h\b/i);
	});
});
