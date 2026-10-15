// tests/brain/rules-actions.test.ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const loadEditorContext = vi.fn();
const loadNewPageRulesPanel = vi.fn();

vi.mock("@/lib/brain/adapters/editor", () => ({
	loadEditorContext,
	loadNewPageRulesPanel,
}));

const { loadNewPageRules } = await import("@/app/[tenant]/brain/rules-actions");

beforeEach(() => {
	loadEditorContext.mockReset();
	loadNewPageRulesPanel.mockReset();
});

describe("loadNewPageRules", () => {
	it("rechaza datos mal formados sin cargar el contexto", async () => {
		expect(
			await loadNewPageRules({ tenantSlug: "A B", folder: "x" }),
		).toBeNull();
		expect(await loadNewPageRules({ tenantSlug: "acme" })).toBeNull();
		expect(loadEditorContext).not.toHaveBeenCalled();
	});

	it("sin brain propio no hay panel", async () => {
		loadEditorContext.mockResolvedValueOnce(null);
		expect(
			await loadNewPageRules({ tenantSlug: "acme", folder: "x" }),
		).toBeNull();
		loadEditorContext.mockResolvedValueOnce({ kind: "external" });
		expect(
			await loadNewPageRules({ tenantSlug: "acme", folder: "x" }),
		).toBeNull();
		expect(loadNewPageRulesPanel).not.toHaveBeenCalled();
	});

	it("pide el panel de la carpeta con el contexto de la persona", async () => {
		const ctx = { kind: "ok" };
		const view = { kind: "rules", entries: [] };
		loadEditorContext.mockResolvedValueOnce(ctx);
		loadNewPageRulesPanel.mockResolvedValueOnce(view);
		expect(
			await loadNewPageRules({ tenantSlug: "acme", folder: "comercial" }),
		).toBe(view);
		expect(loadEditorContext).toHaveBeenCalledWith("acme");
		expect(loadNewPageRulesPanel).toHaveBeenCalledWith(ctx, "comercial");
	});
});
