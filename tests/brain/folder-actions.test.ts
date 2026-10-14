import { beforeEach, describe, expect, it, vi } from "vitest";

const createFolder = vi.fn();
const describeFolder = vi.fn();
const deleteFolder = vi.fn();
const revalidatePath = vi.fn();

vi.mock("next/cache", () => ({ revalidatePath }));
vi.mock("@/lib/brain/adapters/folders", () => ({ folderDeps: () => ({}) }));
vi.mock("@/lib/brain/core/editor/folders", () => ({
	createFolder,
	describeFolder,
	deleteFolder,
}));

const { createBrainFolder, deleteBrainFolder, describeBrainFolder } =
	await import("@/app/[tenant]/brain/folder-actions");

beforeEach(() => {
	for (const fn of [createFolder, describeFolder, deleteFolder, revalidatePath])
		fn.mockReset();
});

describe("folder actions", () => {
	it("rechaza datos mal formados sin llegar al núcleo", async () => {
		expect(
			await createBrainFolder({
				tenantSlug: "A B",
				path: "x",
				description: "",
			}),
		).toMatchObject({
			code: "invalid",
		});
		expect(
			await deleteBrainFolder({ tenantSlug: "okeefe", path: "" }),
		).toMatchObject({
			code: "invalid",
		});
		expect(createFolder).not.toHaveBeenCalled();
		expect(deleteFolder).not.toHaveBeenCalled();
	});

	it("revalida el brain solo si salió bien", async () => {
		createFolder.mockResolvedValueOnce({ ok: true });
		await createBrainFolder({
			tenantSlug: "okeefe",
			path: "marketing",
			description: "",
		});
		expect(revalidatePath).toHaveBeenCalledWith("/okeefe/brain", "layout");

		revalidatePath.mockReset();
		describeFolder.mockResolvedValueOnce({
			ok: false,
			code: "forbidden",
			message: "x",
		});
		await describeBrainFolder({
			tenantSlug: "okeefe",
			path: "marketing",
			description: "y",
		});
		expect(revalidatePath).not.toHaveBeenCalled();
	});
});
