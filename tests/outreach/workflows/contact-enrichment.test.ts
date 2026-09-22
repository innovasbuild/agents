import { describe, expect, it, vi } from "vitest";
import { createContactEnrichmentWorkflow } from "@/lib/outreach/workflows/contact-enrichment";
import type { PassContext } from "@/lib/workflows/runner";
import type { WorkItem } from "@/lib/workflows/types";

const ctx: PassContext = {
	tenantId: "t1",
	runId: "run-1",
	workflow: "contact-enrichment",
	optionalNodes: new Set<string>(),
	useNode: async <T>() => undefined as T,
};

const item: WorkItem = {
	id: 1,
	tenantId: "t1",
	workflow: "contact-enrichment",
	subjectType: "contact",
	subjectId: "c1",
	inputHash: "c1",
	attempts: 1,
};

describe("workflow contact-enrichment", () => {
	it("revela el email, asegura la ficha, y deja downstream para draft-queue", async () => {
		const ensureFicha = vi.fn(async () => ({ ok: true as const }));
		const workflow = createContactEnrichmentWorkflow({
			reveal: async () => ({ ok: true, email: "laura@acme.test", creditsUsed: 1 }),
			ensureFicha,
			recordCredits: async () => {},
		});

		const outcome = await workflow.runItem(item, ctx);

		expect(outcome).toMatchObject({
			ok: true,
			downstream: [{ subjectId: "c1", inputHash: expect.stringMatching(/^c1:msg1:\d{4}-\d{2}-\d{2}$/) }],
		});
		expect(ensureFicha).toHaveBeenCalledWith("c1");
	});

	it("un revelado refusado no asegura la ficha ni deja downstream", async () => {
		const ensureFicha = vi.fn(async () => ({ ok: true as const }));
		const workflow = createContactEnrichmentWorkflow({
			reveal: async () => ({ ok: false, reason: "sin_email", message: "x" }),
			ensureFicha,
			recordCredits: async () => {},
		});

		const outcome = await workflow.runItem(item, ctx);

		expect(outcome).toMatchObject({ ok: false, reason: "sin_email" });
		expect(ensureFicha).not.toHaveBeenCalled();
	});

	it("asienta créditos de Apollo aunque el research falle (el email ya se gastó)", async () => {
		const recordCredits = vi.fn(async () => {});
		const workflow = createContactEnrichmentWorkflow({
			reveal: async () => ({ ok: true, email: "laura@acme.test", creditsUsed: 1 }),
			ensureFicha: async () => ({ ok: false, reason: "sin_hechos", message: "x" }),
			recordCredits,
		});

		const outcome = await workflow.runItem(item, ctx);

		expect(recordCredits).toHaveBeenCalledWith(1, "run-1");
		// Sin ficha no hay ancla: no se puede redactar. El contacto queda
		// revelado (no se pierde el email) pero no avanza a draft-queue.
		expect(outcome).toMatchObject({ ok: true });
		expect((outcome as { downstream?: unknown[] }).downstream ?? []).toHaveLength(0);
	});
});
