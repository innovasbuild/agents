import { beforeEach, describe, expect, it, vi } from "vitest";
import { zipPackage } from "@/lib/brain/adapters/skill-zip";

const state = vi.hoisted(() => ({
	actor: vi.fn(async () => ({ tenantId: "t1", userId: "u1", role: "member" })),
	filesDeps: vi.fn(() => ({ actor: state.actor })),
	binding: vi.fn(),
	previewSkillUpload: vi.fn(),
	commitSkillUpload: vi.fn(),
	recordSkillImport: vi.fn(),
	revalidatePath: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: state.revalidatePath }));
vi.mock("@/lib/connectors/bindings", () => ({
	loadTenantBindings: vi.fn(),
}));
vi.mock("@/lib/brain/core/resolve", () => ({
	resolveBrainBinding: state.binding,
}));
vi.mock("@/lib/brain/adapters/skills", () => ({ filesDeps: state.filesDeps }));
vi.mock("@/lib/brain/adapters/skill-uploads", () => ({
	recordSkillImport: state.recordSkillImport,
}));
vi.mock("@/lib/brain/core/skills/upload", () => ({
	previewSkillUpload: state.previewSkillUpload,
	commitSkillUpload: state.commitSkillUpload,
}));

import { POST } from "@/app/[tenant]/brain/skills/upload/route";
import { MAX_ZIP_BYTES } from "@/lib/brain/core/skills/package";

const params = { params: Promise.resolve({ tenant: "acme" }) };
const SAME = { origin: "https://agentes.innov.as", host: "agentes.innov.as" };
const WIKI = { provider: "wiki", config: { categories: ["skill", "empresa"] } };

const goodZip = () =>
	zipPackage([
		{
			path: "SKILL.md",
			bytes: new TextEncoder().encode("---\nname: reporte\n---\ncuerpo"),
		},
	]);

function send(
	fields: Record<string, string | File | null> = {},
	headers: Record<string, string> = SAME,
): Request {
	const form = new FormData();
	form.set("action", "preview");
	form.set("folder", "ventas");
	form.set("file", new File([new Uint8Array(goodZip())], "p.zip"));
	for (const [key, value] of Object.entries(fields)) {
		if (value === null) form.delete(key);
		else form.set(key, value);
	}
	return new Request("https://agentes.innov.as/acme/brain/skills/upload", {
		method: "POST",
		// Un Request armado a mano no trae Content-Length; el navegador sí.
		headers: { "content-length": "1000", ...headers },
		body: form,
	});
}

const PREVIEW = {
	ok: true,
	mode: "crear",
	slug: "skills/ventas/reporte",
	name: "reporte",
	description: "d",
	files: [],
	totalBytes: 0,
	warnings: [],
};
const RESULT = {
	ok: true,
	mode: "crear",
	slug: "skills/ventas/reporte",
	name: "reporte",
	files: 1,
	revision: 3,
};

beforeEach(() => {
	vi.clearAllMocks();
	state.actor.mockResolvedValue({
		tenantId: "t1",
		userId: "u1",
		role: "member",
	});
	state.binding.mockResolvedValue(WIKI);
	state.previewSkillUpload.mockResolvedValue(PREVIEW);
	state.commitSkillUpload.mockResolvedValue(RESULT);
	state.recordSkillImport.mockResolvedValue(undefined);
});

describe("guardas", () => {
	it("un tenant inválido responde 404 sin tocar nada", async () => {
		const response = await POST(send(), {
			params: Promise.resolve({ tenant: "Acme!" }),
		});
		expect(response.status).toBe(404);
		expect(state.filesDeps).not.toHaveBeenCalled();
	});

	it("un pedido de otro sitio responde 403", async () => {
		const response = await POST(
			send({}, { origin: "https://malo.example", host: "agentes.innov.as" }),
			params,
		);
		expect(response.status).toBe(403);
		expect(state.actor).not.toHaveBeenCalled();
	});

	it("sin Content-Length responde 411", async () => {
		const request = send();
		request.headers.delete("content-length");
		expect((await POST(request, params)).status).toBe(411);
		expect(state.actor).not.toHaveBeenCalled();
	});

	it("un Content-Length enorme responde 413 sin leer el cuerpo", async () => {
		const request = send(
			{},
			{ ...SAME, "content-length": String(MAX_ZIP_BYTES + 65_537) },
		);
		const read = vi.spyOn(request, "formData");
		expect((await POST(request, params)).status).toBe(413);
		expect(read).not.toHaveBeenCalled();
		expect(state.actor).not.toHaveBeenCalled();
	});

	it("quien no es miembro recibe 404 sin que se lea el cuerpo", async () => {
		state.actor.mockResolvedValueOnce(null as never);
		const request = send();
		const read = vi.spyOn(request, "formData");
		expect((await POST(request, params)).status).toBe(404);
		expect(read).not.toHaveBeenCalled();
	});

	it("sin la categoría skill habilitada responde 404 sin leer el cuerpo", async () => {
		state.binding.mockResolvedValue({
			provider: "wiki",
			config: { categories: ["empresa"] },
		});
		const request = send();
		const read = vi.spyOn(request, "formData");
		const response = await POST(request, params);
		expect(response.status).toBe(404);
		expect((await response.json()).message).toBe("No encontrado.");
		expect(read).not.toHaveBeenCalled();
		expect(state.previewSkillUpload).not.toHaveBeenCalled();
	});

	it("sin brain responde 404", async () => {
		state.binding.mockResolvedValue(null);
		expect((await POST(send(), params)).status).toBe(404);
		expect(state.previewSkillUpload).not.toHaveBeenCalled();
	});
});

describe("pedido", () => {
	it.each([
		["sin acción", { action: null }],
		["con una acción desconocida", { action: "borrar" }],
		["sin destino", { folder: null }],
		["con carpeta y slug a la vez", { slug: "skills/a" }],
		["sin archivo", { file: null }],
		["con un archivo que no es un archivo", { file: "texto" }],
	])("%s responde 400", async (_name, fields) => {
		const response = await POST(send(fields), params);
		expect(response.status).toBe(400);
		expect(state.previewSkillUpload).not.toHaveBeenCalled();
	});

	it("un zip que pasa el Content-Length pero pesa de más responde 413", async () => {
		const big = new File([new Uint8Array(MAX_ZIP_BYTES + 1)], "p.zip");
		expect((await POST(send({ file: big }), params)).status).toBe(413);
		expect(state.previewSkillUpload).not.toHaveBeenCalled();
	});

	it("un zip basura responde 422 con el mensaje y sin llamar al servicio", async () => {
		const response = await POST(
			send({ file: new File(["no es zip"], "p.zip") }),
			params,
		);
		expect(response.status).toBe(422);
		const body = await response.json();
		expect(body.ok).toBe(false);
		expect(body.message).toMatch(/zip/i);
		expect(state.previewSkillUpload).not.toHaveBeenCalled();
		expect(state.commitSkillUpload).not.toHaveBeenCalled();
	});
});

describe("vista previa", () => {
	it("devuelve la vista previa sin escribir ni registrar", async () => {
		const response = await POST(send(), params);
		expect(response.status).toBe(200);
		expect(await response.json()).toEqual(PREVIEW);
		expect(state.previewSkillUpload).toHaveBeenCalledWith(
			"acme",
			{ kind: "folder", folder: "ventas" },
			expect.arrayContaining([expect.objectContaining({ path: "SKILL.md" })]),
			expect.anything(),
		);
		expect(state.commitSkillUpload).not.toHaveBeenCalled();
		expect(state.recordSkillImport).not.toHaveBeenCalled();
		expect(state.revalidatePath).not.toHaveBeenCalled();
	});

	it("normaliza la carpeta antes de llamar al servicio", async () => {
		await POST(send({ folder: " /skills/ventas/ " }), params);
		expect(state.previewSkillUpload.mock.calls[0]?.[1]).toEqual({
			kind: "folder",
			folder: "ventas",
		});
	});

	it("acepta la carpeta vacía: directo bajo skills/", async () => {
		await POST(send({ folder: "" }), params);
		expect(state.previewSkillUpload.mock.calls[0]?.[1]).toEqual({
			kind: "folder",
			folder: "",
		});
	});

	it("con slug apunta a esa skill", async () => {
		await POST(send({ folder: null, slug: "skills/ventas/reporte" }), params);
		expect(state.previewSkillUpload.mock.calls[0]?.[1]).toEqual({
			kind: "skill",
			slug: "skills/ventas/reporte",
		});
	});

	it("traduce un fallo del servicio con el mismo mapa de estados", async () => {
		state.previewSkillUpload.mockResolvedValue({
			ok: false,
			code: "validation",
			message: "Falta el name.",
			problems: ["Falta el name."],
		});
		const response = await POST(send(), params);
		expect(response.status).toBe(422);
		expect(await response.json()).toEqual({
			ok: false,
			code: "validation",
			message: "Falta el name.",
			problems: ["Falta el name."],
		});

		state.previewSkillUpload.mockResolvedValue({
			ok: false,
			code: "not_found",
			message: "No encontrado.",
		});
		expect((await POST(send(), params)).status).toBe(404);
	});
});

describe("confirmación", () => {
	it("escribe, revalida el layout y registra el evento por la web", async () => {
		const response = await POST(send({ action: "confirm" }), params);
		expect(response.status).toBe(200);
		expect(await response.json()).toEqual(RESULT);
		expect(state.previewSkillUpload).not.toHaveBeenCalled();
		expect(state.revalidatePath).toHaveBeenCalledWith("/acme/brain", "layout");
		expect(state.recordSkillImport).toHaveBeenCalledWith({
			tenantId: "t1",
			userId: "u1",
			channel: "web",
			slug: "skills/ventas/reporte",
			mode: "crear",
			files: 1,
		});
	});

	it("pasa al servicio el modo y la ruta que mostró la vista previa", async () => {
		await POST(
			send({
				action: "confirm",
				expectedMode: "crear",
				expectedSlug: "skills/ventas/reporte",
			}),
			params,
		);
		expect(state.commitSkillUpload).toHaveBeenCalledWith(
			"acme",
			{ kind: "folder", folder: "ventas" },
			expect.anything(),
			expect.anything(),
			{ mode: "crear", slug: "skills/ventas/reporte" },
		);
	});

	it("sin esos campos confirma como antes", async () => {
		await POST(send({ action: "confirm" }), params);
		expect(state.commitSkillUpload.mock.calls[0]?.[4]).toBeUndefined();
	});

	it.each([
		["solo el modo", { expectedMode: "crear" }],
		["solo la ruta", { expectedSlug: "skills/ventas/reporte" }],
		[
			"un modo desconocido",
			{ expectedMode: "borrar", expectedSlug: "skills/ventas/reporte" },
		],
		["una ruta vacía", { expectedMode: "crear", expectedSlug: "" }],
	])("con %s responde 400 sin escribir", async (_name, fields) => {
		const response = await POST(send({ action: "confirm", ...fields }), params);
		expect(response.status).toBe(400);
		expect(state.commitSkillUpload).not.toHaveBeenCalled();
	});

	it("un fallo del servicio no revalida ni registra", async () => {
		state.commitSkillUpload.mockResolvedValue({
			ok: false,
			code: "conflict",
			message: "x",
		});
		const response = await POST(send({ action: "confirm" }), params);
		expect(response.status).toBe(409);
		expect(state.revalidatePath).not.toHaveBeenCalled();
		expect(state.recordSkillImport).not.toHaveBeenCalled();
	});

	it("un fallo al registrar el evento no cambia la respuesta", async () => {
		const logged = vi.spyOn(console, "error").mockImplementation(() => {});
		state.recordSkillImport.mockRejectedValue(new Error("events caído"));
		const response = await POST(send({ action: "confirm" }), params);
		expect(response.status).toBe(200);
		expect(await response.json()).toEqual(RESULT);
		expect(logged).toHaveBeenCalled();
		logged.mockRestore();
	});
});

describe("errores inesperados", () => {
	it("responde 500 en castellano sin internos", async () => {
		const logged = vi.spyOn(console, "error").mockImplementation(() => {});
		state.previewSkillUpload.mockRejectedValue(new Error("bucket secreto"));
		const response = await POST(send(), params);
		expect(response.status).toBe(500);
		const body = JSON.stringify(await response.json());
		expect(body).toContain("No pude");
		expect(body).not.toContain("secreto");
		logged.mockRestore();
	});
});
