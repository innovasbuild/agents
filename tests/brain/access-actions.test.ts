import { beforeEach, describe, expect, it, vi } from "vitest";

const changeAccess = vi.fn();
const revalidatePath = vi.fn();

vi.mock("next/cache", () => ({ revalidatePath }));
vi.mock("@/lib/brain/adapters/access-admin", () => ({
	manageDeps: () => ({}),
	loadShareState: vi.fn(async () => ({ ok: true })),
}));
vi.mock("@/lib/brain/core/access/manage", () => ({ changeAccess }));

const { grantAccess, revokeAccess, setGeneralAccess } = await import(
	"@/app/[tenant]/brain/access-actions"
);

const USER = "7c1d3f0e-0000-4000-8000-000000000001";

beforeEach(() => {
	changeAccess.mockReset();
	revalidatePath.mockReset();
});

describe("access actions", () => {
	it("rechaza datos mal formados sin llegar a changeAccess", async () => {
		expect(
			await grantAccess({
				tenantSlug: "A B",
				path: "x",
				userId: USER,
				level: "lector",
			}),
		).toMatchObject({ ok: false, code: "invalid" });
		expect(
			await grantAccess({
				tenantSlug: "innovas",
				path: "x",
				userId: "no-uuid",
				level: "lector",
			}),
		).toMatchObject({ code: "invalid" });
		expect(
			await grantAccess({
				tenantSlug: "innovas",
				path: "x",
				userId: USER,
				level: "ninguno",
			}),
		).toMatchObject({ code: "invalid" });
		expect(
			await setGeneralAccess({
				tenantSlug: "innovas",
				path: "x",
				level: "administrador",
			}),
		).toMatchObject({ code: "invalid" });
		expect(changeAccess).not.toHaveBeenCalled();
	});

	it("pasa el cambio ya validado y revalida el brain solo si salió bien", async () => {
		changeAccess.mockResolvedValueOnce({ ok: true });
		expect(
			await grantAccess({
				tenantSlug: "innovas",
				path: "comercial",
				userId: USER,
				level: "editor",
			}),
		).toEqual({ ok: true });
		expect(changeAccess).toHaveBeenCalledWith(
			"innovas",
			{ kind: "grant", path: "comercial", userId: USER, level: "editor" },
			{},
		);
		expect(revalidatePath).toHaveBeenCalledWith("/innovas/brain", "layout");

		revalidatePath.mockReset();
		changeAccess.mockResolvedValueOnce({
			ok: false,
			code: "forbidden",
			message: "no",
		});
		await revokeAccess({
			tenantSlug: "innovas",
			path: "comercial",
			userId: USER,
		});
		expect(revalidatePath).not.toHaveBeenCalled();
	});
});
