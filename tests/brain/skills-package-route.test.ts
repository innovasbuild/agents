import { unzipSync } from "fflate";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
	filesDeps: vi.fn(() => ({})),
	exportSkillPackage: vi.fn(),
}));

vi.mock("@/lib/brain/adapters/skills", () => ({ filesDeps: state.filesDeps }));
vi.mock("@/lib/brain/core/skills/files", () => ({
	exportSkillPackage: state.exportSkillPackage,
}));

import { GET } from "@/app/[tenant]/brain/skills/package/route";

const params = (tenant = "acme") => ({ params: Promise.resolve({ tenant }) });
const get = (query: string) =>
	new Request(`https://agentes.innov.as/acme/brain/skills/package${query}`);

beforeEach(() => vi.clearAllMocks());

describe("GET /brain/skills/package", () => {
	it("devuelve el zip como descarga, sin caché y sin sniffing", async () => {
		state.exportSkillPackage.mockResolvedValue({
			ok: true,
			name: "reporte",
			version: 3,
			entries: [
				{ path: "reporte/SKILL.md", bytes: new TextEncoder().encode("hola") },
			],
		});
		const response = await GET(get("?slug=skills/ventas/reporte"), params());
		expect(response.status).toBe(200);
		expect(response.headers.get("content-type")).toBe("application/zip");
		expect(response.headers.get("content-disposition")).toBe(
			'attachment; filename="reporte-v3.zip"',
		);
		expect(response.headers.get("x-content-type-options")).toBe("nosniff");
		expect(response.headers.get("cache-control")).toBe("no-store");
		const files = unzipSync(new Uint8Array(await response.arrayBuffer()));
		expect(new TextDecoder().decode(files["reporte/SKILL.md"])).toBe("hola");
		expect(state.exportSkillPackage).toHaveBeenCalledWith(
			"acme",
			"skills/ventas/reporte",
			expect.anything(),
		);
	});

	it("404 sin slug, con tenant inválido o cuando no se puede exportar", async () => {
		expect((await GET(get(""), params())).status).toBe(404);
		expect((await GET(get("?slug=skills/a"), params("Acme_malo"))).status).toBe(
			404,
		);
		expect(state.exportSkillPackage).not.toHaveBeenCalled();
		state.exportSkillPackage.mockResolvedValue({
			ok: false,
			code: "not_found",
			message: "No encontrado.",
		});
		expect((await GET(get("?slug=skills/a"), params())).status).toBe(404);
	});

	it("500 sin detalles si falla el armado", async () => {
		const spy = vi.spyOn(console, "error").mockImplementation(() => {});
		state.exportSkillPackage.mockRejectedValue(
			new Error("falta un blob sha-x"),
		);
		const response = await GET(get("?slug=skills/a"), params());
		expect(response.status).toBe(500);
		expect(await response.text()).not.toContain("sha-x");
		spy.mockRestore();
	});
});
