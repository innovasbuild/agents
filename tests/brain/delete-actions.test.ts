import { beforeEach, describe, expect, it, vi } from "vitest";

const previewDelete = vi.fn();
const deletePage = vi.fn();
const revalidatePath = vi.fn();

vi.mock("next/cache", () => ({ revalidatePath }));
vi.mock("@/lib/brain/adapters/delete-page", () => ({ deleteDeps: () => ({}) }));
vi.mock("@/lib/brain/core/editor/delete", () => ({
	previewDelete,
	deletePage,
}));

const { getDeletePreview, deleteBrainPage } = await import(
	"@/app/[tenant]/brain/delete-actions"
);

beforeEach(() => {
	previewDelete.mockReset();
	deletePage.mockReset();
	revalidatePath.mockReset();
});

describe("delete actions", () => {
	it("rechaza datos mal formados sin llegar al núcleo", async () => {
		expect(
			await getDeletePreview({ tenantSlug: "A B", slug: "x" }),
		).toMatchObject({ ok: false, code: "invalid" });
		expect(
			await getDeletePreview({ tenantSlug: "innovas", slug: "" }),
		).toMatchObject({ code: "invalid" });
		expect(
			await deleteBrainPage({
				tenantSlug: "innovas",
				slug: "x",
				expectedRevision: 0,
			}),
		).toMatchObject({ code: "invalid" });
		expect(
			await deleteBrainPage({
				tenantSlug: "innovas",
				slug: "x",
				expectedRevision: 1.5,
			}),
		).toMatchObject({ code: "invalid" });
		expect(previewDelete).not.toHaveBeenCalled();
		expect(deletePage).not.toHaveBeenCalled();
	});

	it("la vista previa pasa tenant y slug ya validados y no revalida nada", async () => {
		previewDelete.mockResolvedValueOnce({ ok: true, preview: {} });
		await getDeletePreview({ tenantSlug: "innovas", slug: "comercial/icp" });
		expect(previewDelete).toHaveBeenCalledWith("innovas", "comercial/icp", {});
		expect(revalidatePath).not.toHaveBeenCalled();
	});

	it("borrar pasa la revisión esperada y revalida el brain solo si salió bien", async () => {
		deletePage.mockResolvedValueOnce({ ok: true, cleaned: 2 });
		expect(
			await deleteBrainPage({
				tenantSlug: "innovas",
				slug: "comercial/icp",
				expectedRevision: 3,
			}),
		).toEqual({ ok: true, cleaned: 2 });
		expect(deletePage).toHaveBeenCalledWith("innovas", "comercial/icp", 3, {});
		expect(revalidatePath).toHaveBeenCalledWith("/innovas/brain", "layout");

		revalidatePath.mockReset();
		deletePage.mockResolvedValueOnce({
			ok: false,
			code: "forbidden",
			message: "no",
		});
		await deleteBrainPage({
			tenantSlug: "innovas",
			slug: "comercial/icp",
			expectedRevision: 3,
		});
		expect(revalidatePath).not.toHaveBeenCalled();
	});
});
