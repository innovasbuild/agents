import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
	filesDeps: vi.fn(() => ({})),
	putSkillFile: vi.fn(async () => ({ ok: true, filesDigest: "d" })),
	readSkillFile: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/brain/adapters/skills", () => ({ filesDeps: state.filesDeps }));
vi.mock("@/lib/brain/core/skills/files", () => ({
	importSkillPackage: vi.fn(),
	putSkillFile: state.putSkillFile,
	readSkillFile: state.readSkillFile,
}));

import { GET, POST } from "@/app/[tenant]/brain/skills/files/route";

const params = { params: Promise.resolve({ tenant: "acme" }) };

function upload(headers: Record<string, string>): Request {
	const form = new FormData();
	form.set("slug", "skills/a");
	form.set("path", "a.txt");
	form.set("file", new File(["hola"], "a.txt"));
	return new Request("https://agentes.innov.as/acme/brain/skills/files", {
		method: "POST",
		headers,
		body: form,
	});
}

beforeEach(() => vi.clearAllMocks());

describe("POST /brain/skills/files", () => {
	it("rechaza con 403 un pedido de otro sitio sin tocar nada", async () => {
		const response = await POST(
			upload({ origin: "https://malo.example", host: "agentes.innov.as" }),
			params,
		);
		expect(response.status).toBe(403);
		expect(state.filesDeps).not.toHaveBeenCalled();
		expect(state.putSkillFile).not.toHaveBeenCalled();
	});

	it("rechaza con 403 un pedido sin origin", async () => {
		const response = await POST(upload({ host: "agentes.innov.as" }), params);
		expect(response.status).toBe(403);
		expect(state.putSkillFile).not.toHaveBeenCalled();
	});

	it("acepta un pedido del mismo origen", async () => {
		const response = await POST(
			upload({
				origin: "https://agentes.innov.as",
				host: "agentes.innov.as",
			}),
			params,
		);
		expect(response.status).toBe(200);
		expect(state.putSkillFile).toHaveBeenCalledOnce();
	});
});

describe("GET /brain/skills/files", () => {
	const get = () =>
		GET(
			new Request(
				"https://agentes.innov.as/acme/brain/skills/files?slug=skills%2Fa&path=x.html",
			),
			params,
		);

	it("sirve un html como texto plano, con nosniff", async () => {
		state.readSkillFile.mockResolvedValue({
			ok: true,
			path: "x.html",
			bytes: new TextEncoder().encode("<script>alert(1)</script>"),
		});
		const response = await get();
		expect(response.headers.get("content-type")).toBe(
			"text/plain; charset=utf-8",
		);
		expect(response.headers.get("x-content-type-options")).toBe("nosniff");
	});

	it("responde 404 igual ante cualquier rechazo", async () => {
		state.readSkillFile.mockResolvedValue({
			ok: false,
			code: "forbidden",
			message: "x",
		});
		expect((await get()).status).toBe(404);
	});
});
