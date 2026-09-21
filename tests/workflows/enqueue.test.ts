import { describe, expect, it, vi } from "vitest";
import { enqueue } from "@/lib/workflows/enqueue";

const base = {
	tenantId: "t1",
	workflow: "refresh-fichas",
	subjectType: "account",
	subjectId: "acc-1",
	inputHash: "h1",
};

describe("enqueue", () => {
	it("encola un ítem nuevo", async () => {
		const insertWorkItem = vi.fn(async () => "inserted" as const);
		expect(await enqueue(base, { store: { insertWorkItem } })).toEqual({
			enqueued: true,
		});
		expect(insertWorkItem).toHaveBeenCalledWith(base);
	});

	it("algo ya visto no es error: es la deduplicación haciendo su trabajo", async () => {
		const insertWorkItem = vi.fn(async () => "ya_visto" as const);
		expect(await enqueue(base, { store: { insertWorkItem } })).toEqual({
			enqueued: false,
			reason: "ya_visto",
		});
	});

	it("no encola para un workflow que no está en el registry", async () => {
		const insertWorkItem = vi.fn();
		expect(
			await enqueue(
				{ ...base, workflow: "no-existe" },
				{ store: { insertWorkItem } },
			),
		).toEqual({ enqueued: false, reason: "workflow_desconocido" });
		expect(insertWorkItem).not.toHaveBeenCalled();
	});

	it("no encola un sujeto del tipo equivocado para ese workflow", async () => {
		const insertWorkItem = vi.fn();
		expect(
			await enqueue(
				{ ...base, subjectType: "contact" },
				{ store: { insertWorkItem } },
			),
		).toEqual({ enqueued: false, reason: "sujeto_equivocado" });
		expect(insertWorkItem).not.toHaveBeenCalled();
	});
});
