import { describe, expect, it, vi } from "vitest";
import { createDraftQueueWorkflow } from "@/lib/outreach/workflows/draft-queue";

const ctx = {
	tenantId: "t1",
	runId: "run-1",
	workflow: "draft-queue",
	optionalNodes: new Set<string>(),
	useNode: async <T>() => undefined as T,
};

function item(hash: string) {
	return {
		id: 1,
		tenantId: "t1",
		workflow: "draft-queue",
		subjectType: "contact",
		subjectId: "c1",
		inputHash: hash,
		attempts: 1,
	};
}

describe("workflow draft-queue", () => {
	it("con cupo disponible, redacta, verifica y encola", async () => {
		const queue = vi.fn(async () => ({ ok: true as const, queueItemId: "q1" }));
		const workflow = createDraftQueueWorkflow({
			ownerOf: async () => "exec-1",
			quotaFor: async () => 5,
			queuedToday: async () => 2,
			draft: async () => ({
				ok: true,
				subject: "s",
				body: "b",
				ancla: { hecho: "h", fuente: "https://acme.test" },
			}),
			verify: async () => ({ verified: true, confidence: 0.9 }),
			queue,
		});

		const outcome = await workflow.runItem(item("c1:msg1:2026-09-22"), ctx);

		expect(outcome).toMatchObject({ ok: true });
		expect(queue).toHaveBeenCalled();
	});

	it("sin cupo hoy, refusa sin llamar a draftMessage", async () => {
		const draft = vi.fn();
		const workflow = createDraftQueueWorkflow({
			ownerOf: async () => "exec-1",
			quotaFor: async () => 5,
			queuedToday: async () => 5,
			draft,
			verify: async () => ({ verified: true, confidence: 0.9 }),
			queue: async () => ({ ok: true, queueItemId: "q1" }),
		});

		const outcome = await workflow.runItem(item("c1:msg1:2026-09-22"), ctx);

		expect(outcome).toMatchObject({ ok: false, reason: "cupo_agotado" });
		expect(draft).not.toHaveBeenCalled();
	});

	it("un ancla que no verifica no se encola", async () => {
		const queue = vi.fn();
		const workflow = createDraftQueueWorkflow({
			ownerOf: async () => "exec-1",
			quotaFor: async () => 5,
			queuedToday: async () => 0,
			draft: async () => ({
				ok: true,
				subject: "s",
				body: "b",
				ancla: { hecho: "h", fuente: "https://acme.test" },
			}),
			verify: async () => ({ verified: false, confidence: 0.2 }),
			queue,
		});

		const outcome = await workflow.runItem(item("c1:msg1:2026-09-22"), ctx);

		expect(outcome).toMatchObject({ ok: false, reason: "ancla_no_verificada" });
		expect(queue).not.toHaveBeenCalled();
	});

	it("un refusal de draftMessage se propaga tal cual", async () => {
		const workflow = createDraftQueueWorkflow({
			ownerOf: async () => "exec-1",
			quotaFor: async () => 5,
			queuedToday: async () => 0,
			draft: async () => ({
				ok: false,
				reason: "falta_research",
				message: "x",
			}),
			verify: async () => ({ verified: true, confidence: 1 }),
			queue: async () => ({ ok: true, queueItemId: "q1" }),
		});

		const outcome = await workflow.runItem(item("c1:msg1:2026-09-22"), ctx);

		expect(outcome).toMatchObject({ ok: false, reason: "falta_research" });
	});

	it("el sembrador siembra con la fecha de hoy a los contactos listos", async () => {
		const now = new Date("2026-09-22T15:00:00Z");
		const workflow = createDraftQueueWorkflow({
			ownerOf: async () => "exec-1",
			quotaFor: async () => 5,
			queuedToday: async () => 0,
			listReady: async () => [
				{ contactId: "c1", contactKey: "em:laura@acme.test" },
			],
			draft: async () => ({ ok: false, reason: "x", message: "x" }),
			verify: async () => ({ verified: true, confidence: 1 }),
			queue: async () => ({ ok: true, queueItemId: "q1" }),
		});

		const seeded = await workflow.seed?.("t1", now);

		expect(seeded).toEqual([
			{ subjectId: "c1", inputHash: "c1:msg1:2026-09-22" },
		]);
	});
});
