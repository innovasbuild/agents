import { beforeEach, describe, expect, it, vi } from "vitest";

const previewDelete = vi.fn();
const deletePage = vi.fn();
const revalidatePath = vi.fn();

const reflectMarcoForTenant = vi.fn();
vi.mock("@/lib/outreach/marco-reflect", () => ({ reflectMarcoForTenant }));
vi.mock("@/lib/tenants/resolve", () => ({
	resolveTenantAccess: async () => ({ id: "t1" }),
}));
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
	reflectMarcoForTenant.mockReset();
	previewDelete.mockResolvedValue({
		ok: false,
		code: "not_found",
		message: "No encontrado.",
	});
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

	it("al borrar una página canon:hooks refleja el marco", async () => {
		previewDelete.mockResolvedValue({
			ok: true,
			preview: { canonTags: ["canon:hooks"] },
		});
		deletePage.mockResolvedValue({ ok: true, cleaned: 0 });
		await deleteBrainPage({
			tenantSlug: "acme",
			slug: "comercial/hooks",
			expectedRevision: 3,
		});
		expect(reflectMarcoForTenant).toHaveBeenCalledWith("t1");
	});

	it("no refleja si la página no era canon:hooks, ni si el borrado falló", async () => {
		previewDelete.mockResolvedValue({
			ok: true,
			preview: { canonTags: ["canon:icp"] },
		});
		deletePage.mockResolvedValue({ ok: true, cleaned: 0 });
		await deleteBrainPage({
			tenantSlug: "acme",
			slug: "x",
			expectedRevision: 3,
		});

		previewDelete.mockResolvedValue({
			ok: true,
			preview: { canonTags: ["canon:hooks"] },
		});
		deletePage.mockResolvedValue({
			ok: false,
			code: "conflict",
			message: "cambió",
		});
		await deleteBrainPage({
			tenantSlug: "acme",
			slug: "x",
			expectedRevision: 3,
		});

		expect(reflectMarcoForTenant).not.toHaveBeenCalled();
	});

	it("un reflejo que tira no cambia el resultado del borrado", async () => {
		previewDelete.mockResolvedValue({
			ok: true,
			preview: { canonTags: ["canon:hooks"] },
		});
		deletePage.mockResolvedValue({ ok: true, cleaned: 0 });
		reflectMarcoForTenant.mockRejectedValue(new Error("base caída"));
		const log = vi.spyOn(console, "error").mockImplementation(() => {});
		expect(
			await deleteBrainPage({
				tenantSlug: "acme",
				slug: "x",
				expectedRevision: 3,
			}),
		).toEqual({ ok: true, cleaned: 0 });
		log.mockRestore();
	});
});
