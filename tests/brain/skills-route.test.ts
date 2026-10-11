import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
	actor: vi.fn(async () => ({ tenantId: "t", userId: "u", role: "member" })),
	filesDeps: vi.fn(() => ({ actor: state.actor })),
	authorizeSkillEdit: vi.fn(async () => ({ ok: true })),
	importSkillPackage: vi.fn(),
	putSkillFile: vi.fn(async () => ({ ok: true, filesDigest: "d" })),
	readSkillFile: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/brain/adapters/skills", () => ({ filesDeps: state.filesDeps }));
vi.mock("@/lib/brain/core/skills/files", () => ({
	authorizeSkillEdit: state.authorizeSkillEdit,
	importSkillPackage: state.importSkillPackage,
	putSkillFile: state.putSkillFile,
	readSkillFile: state.readSkillFile,
}));

import { GET, POST } from "@/app/[tenant]/brain/skills/files/route";

const params = { params: Promise.resolve({ tenant: "acme" }) };

function upload(
	headers: Record<string, string>,
	extra: Record<string, string | File> = {},
): Request {
	const form = new FormData();
	form.set("slug", "skills/a");
	form.set("path", "a.txt");
	form.set("file", new File(["hola"], "a.txt"));
	for (const [key, value] of Object.entries(extra)) form.set(key, value);
	return new Request("https://agentes.innov.as/acme/brain/skills/files", {
		method: "POST",
		// Un Request armado a mano no trae Content-Length; el navegador sí.
		headers: { "content-length": "1000", ...headers },
		body: form,
	});
}

const SAME = { origin: "https://agentes.innov.as", host: "agentes.innov.as" };

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

describe("POST: lo barato primero", () => {
	it("sin Content-Length responde 411", async () => {
		const request = upload(SAME);
		request.headers.delete("content-length");
		expect((await POST(request, params)).status).toBe(411);
		expect(state.actor).not.toHaveBeenCalled();
	});

	it("quien no es miembro recibe 404 sin que se lea el cuerpo", async () => {
		state.actor.mockResolvedValueOnce(null as never);
		const request = upload(SAME);
		const read = vi.spyOn(request, "formData");
		expect((await POST(request, params)).status).toBe(404);
		expect(read).not.toHaveBeenCalled();
	});

	it("quien no puede editar la skill no hace descomprimir el zip", async () => {
		state.authorizeSkillEdit.mockResolvedValueOnce({
			ok: false,
			code: "forbidden",
			message: "x",
		} as never);
		const response = await POST(
			upload(SAME, { kind: "zip", file: new File(["no es zip"], "p.zip") }),
			params,
		);
		expect(response.status).toBe(403);
		expect(state.importSkillPackage).not.toHaveBeenCalled();
	});

	it("un fallo de Storage responde en castellano sin internos", async () => {
		const logged = vi.spyOn(console, "error").mockImplementation(() => {});
		state.putSkillFile.mockRejectedValueOnce(new Error("bucket secreto caído"));
		const response = await POST(upload(SAME), params);
		expect(response.status).toBe(500);
		const body = JSON.stringify(await response.json());
		expect(body).toContain("No pude guardar");
		expect(body).not.toContain("secreto");
		logged.mockRestore();
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
