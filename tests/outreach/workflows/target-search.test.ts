import { describe, expect, it, vi } from "vitest";
import { createTargetSearchWorkflow } from "@/lib/outreach/workflows/target-search";
import type { PassContext } from "@/lib/workflows/runner";

const focus = {
	id: "f1",
	tenantId: "t1",
	createdBy: "u1",
	name: "Envases",
	criteria: {},
	vector: "v1",
	segment: "s1",
	hook: "h1",
	idioma: "es_ar",
	maxAccounts: 10,
	maxContacts: 20,
	status: "activo" as const,
	accountsFound: 0,
	contactsFound: 0,
};

const ctx: PassContext = {
	tenantId: "t1",
	runId: "run-1",
	workflow: "target-search",
	optionalNodes: new Set<string>(),
	useNode: async <T>() => undefined as T,
};

describe("workflow target-search", () => {
	it("siembra una página por cada foco activo", async () => {
		const workflow = createTargetSearchWorkflow({
			loadFocuses: async () => [focus],
			loadFocus: async () => focus,
			search: async () => ({
				ok: true,
				contactIds: [],
				accounts: 0,
				discarded: {},
				hasMore: false,
				creditsUsed: 1,
			}),
			updateFocus: async () => {},
			recordCredits: async () => {},
		});

		const seeded = await workflow.seed?.("t1", new Date());
		expect(seeded).toEqual([{ subjectId: "f1", inputHash: "f1:p1" }]);
	});

	it("con progreso ya hecho, siembra la página siguiente en vez de repetir la primera", async () => {
		const avanzado = { ...focus, accountsFound: 100 };
		const workflow = createTargetSearchWorkflow({
			loadFocuses: async () => [avanzado],
			loadFocus: async () => avanzado,
			search: async () => ({
				ok: true,
				contactIds: [],
				accounts: 0,
				discarded: {},
				hasMore: false,
				creditsUsed: 1,
			}),
			updateFocus: async () => {},
			recordCredits: async () => {},
		});

		const seeded = await workflow.seed?.("t1", new Date());
		expect(seeded).toEqual([{ subjectId: "f1", inputHash: "f1:p2" }]);
	});

	it("los contactos descubiertos viajan como downstream", async () => {
		const workflow = createTargetSearchWorkflow({
			loadFocuses: async () => [],
			loadFocus: async () => focus,
			search: async () => ({
				ok: true,
				contactIds: ["c1", "c2"],
				accounts: 1,
				discarded: {},
				hasMore: false,
				creditsUsed: 2,
			}),
			updateFocus: async () => {},
			recordCredits: async () => {},
		});

		const outcome = await workflow.runItem(
			{
				id: 1,
				tenantId: "t1",
				workflow: "target-search",
				subjectType: "search_focus",
				subjectId: "f1",
				inputHash: "f1:p1",
				attempts: 1,
			},
			ctx,
		);

		expect(outcome).toMatchObject({
			ok: true,
			downstream: [
				{ subjectId: "c1", inputHash: "c1" },
				{ subjectId: "c2", inputHash: "c2" },
			],
		});
	});

	it("asienta los créditos gastados aunque la página no traiga a nadie", async () => {
		const recordCredits = vi.fn(async () => {});
		const workflow = createTargetSearchWorkflow({
			loadFocuses: async () => [],
			loadFocus: async () => focus,
			search: async () => ({
				ok: true,
				contactIds: [],
				accounts: 0,
				discarded: { sin_dominio: 3 },
				hasMore: false,
				creditsUsed: 1,
			}),
			updateFocus: async () => {},
			recordCredits,
		});

		await workflow.runItem(
			{
				id: 1,
				tenantId: "t1",
				workflow: "target-search",
				subjectType: "search_focus",
				subjectId: "f1",
				inputHash: "f1:p1",
				attempts: 1,
			},
			ctx,
		);

		expect(recordCredits).toHaveBeenCalledWith(1, "run-1");
	});

	it("cuando no hay más páginas, el foco queda agotado", async () => {
		const updateFocus = vi.fn(async () => {});
		const workflow = createTargetSearchWorkflow({
			loadFocuses: async () => [],
			loadFocus: async () => focus,
			search: async () => ({
				ok: true,
				contactIds: ["c1"],
				accounts: 1,
				discarded: {},
				hasMore: false,
				creditsUsed: 2,
			}),
			updateFocus,
			recordCredits: async () => {},
		});

		await workflow.runItem(
			{
				id: 1,
				tenantId: "t1",
				workflow: "target-search",
				subjectType: "search_focus",
				subjectId: "f1",
				inputHash: "f1:p1",
				attempts: 1,
			},
			ctx,
		);

		expect(updateFocus).toHaveBeenCalledWith(
			"t1",
			"f1",
			expect.objectContaining({ status: "agotado" }),
		);
	});
});
