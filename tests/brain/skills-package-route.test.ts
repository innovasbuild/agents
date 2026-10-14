import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
	filesDeps: vi.fn(() => ({})),
	packageLinkDeps: vi.fn(() => ({})),
	publishedSkillFor: vi.fn(),
	issuePackageLink: vi.fn(),
}));

vi.mock("@/lib/brain/adapters/skills", () => ({ filesDeps: state.filesDeps }));
vi.mock("@/lib/brain/adapters/skill-packages", () => ({
	packageLinkDeps: state.packageLinkDeps,
}));
vi.mock("@/lib/brain/core/skills/files", () => ({
	publishedSkillFor: state.publishedSkillFor,
}));
vi.mock("@/lib/brain/core/skills/package-link", () => ({
	issuePackageLink: state.issuePackageLink,
}));

import { GET } from "@/app/[tenant]/brain/skills/package/route";

const params = (tenant = "acme") => ({ params: Promise.resolve({ tenant }) });
const get = (query: string) =>
	new Request(`https://agentes.innov.as/acme/brain/skills/package${query}`);

const snapshot = { version: 3, digest: "dg" };

beforeEach(() => vi.clearAllMocks());

describe("GET /brain/skills/package", () => {
	it("redirige al link firmado por web, sin caché", async () => {
		state.publishedSkillFor.mockResolvedValue({
			ok: true,
			tenantId: "t1",
			userId: "ana",
			slug: "skills/ventas/reporte",
			snapshot,
		});
		state.issuePackageLink.mockResolvedValue({
			name: "reporte",
			version: 3,
			filename: "reporte-v3.zip",
			url: "https://storage.test/firmado",
			expiresIn: 60,
		});
		const response = await GET(get("?slug=skills/ventas/reporte"), params());
		expect(response.status).toBe(302);
		expect(response.headers.get("location")).toBe(
			"https://storage.test/firmado",
		);
		expect(response.headers.get("cache-control")).toBe("no-store");
		expect(state.publishedSkillFor).toHaveBeenCalledWith(
			"acme",
			"skills/ventas/reporte",
			expect.anything(),
		);
		expect(state.issuePackageLink).toHaveBeenCalledWith(
			{
				tenantId: "t1",
				userId: "ana",
				channel: "web",
				slug: "skills/ventas/reporte",
				snapshot,
			},
			expect.anything(),
		);
	});

	it("404 sin slug, con tenant inválido o cuando la persona no ve la skill publicada", async () => {
		expect((await GET(get(""), params())).status).toBe(404);
		expect((await GET(get("?slug=skills/a"), params("Acme_malo"))).status).toBe(
			404,
		);
		expect(state.publishedSkillFor).not.toHaveBeenCalled();
		state.publishedSkillFor.mockResolvedValue({
			ok: false,
			code: "not_found",
			message: "No encontrado.",
		});
		expect((await GET(get("?slug=skills/a"), params())).status).toBe(404);
		expect(state.issuePackageLink).not.toHaveBeenCalled();
	});

	it("500 sin detalles si falla el storage", async () => {
		const spy = vi.spyOn(console, "error").mockImplementation(() => {});
		state.publishedSkillFor.mockResolvedValue({
			ok: true,
			tenantId: "t1",
			userId: "ana",
			slug: "skills/a",
			snapshot,
		});
		state.issuePackageLink.mockRejectedValue(
			new Error("bucket t1/dg.zip caído"),
		);
		const response = await GET(get("?slug=skills/a"), params());
		expect(response.status).toBe(500);
		expect(await response.text()).not.toContain("t1/dg");
		spy.mockRestore();
	});
});
