// Subir una skill por MCP (spec etapa 24.6 §3 "MCP"): skill_upload_link entrega
// un link y skill_import lee el zip preparado. El staging es un fake que indexa
// por tenant, persona y uploadId, como lo arma el adaptador.
import { afterEach, describe, expect, it, vi } from "vitest";
import { unzipOrProblem, zipPackage } from "@/lib/brain/adapters/skill-zip";
import { resolveAccess } from "@/lib/brain/core/access/resolve-access";
import type { AccessRule, Principal } from "@/lib/brain/core/access/types";
import { MAX_ZIP_BYTES } from "@/lib/brain/core/skills/package";
import { makeUploadId, parseUploadId } from "@/lib/brain/core/skills/upload-id";
import {
	createSkillUploads,
	type UploadStaging,
	uploadableSkillFolders,
} from "@/lib/brain/core/skills/upload-mcp";
import type { BrainRole } from "@/lib/brain/core/types";
import { bytes, members, setup, skillRow } from "./skills-fixtures";

const ADMIN = [members("skills/ventas", "administrador")];
const SLUG = "skills/ventas/facturacion";

const SKILL_MD =
	"---\nname: facturacion\ndescription: Usar para emitir facturas.\n---\n\n# Facturación\n\nPasos.\n";

function zip(skillMd = SKILL_MD): Uint8Array {
	return zipPackage([
		{ path: "facturacion/SKILL.md", bytes: bytes(skillMd) },
		{ path: "facturacion/scripts/calc.py", bytes: bytes("print(1)") },
		{ path: "facturacion/references/guia.md", bytes: bytes("# Guía") },
	]);
}

type Key = { tenantId: string; userId: string; uploadId: string };
const keyOf = (i: Key) => `${i.tenantId}/${i.userId}/${i.uploadId}`;

function fakeStaging() {
	const objects = new Map<string, Uint8Array>();
	const staging = {
		issue: vi.fn(async (i: Key) => ({
			url: `https://storage.test/${keyOf(i)}`,
			expiresIn: 600,
		})),
		read: vi.fn(async (i: Key) => objects.get(keyOf(i)) ?? null),
		remove: vi.fn(async (i: Key) => {
			objects.delete(keyOf(i));
		}),
	} satisfies UploadStaging;
	return { staging, objects };
}

// La persona del fixture es "ana" en el tenant "t1".
function build(opts: { rules?: AccessRule[]; role?: BrainRole } = {}) {
	const rules = opts.rules ?? ADMIN;
	const files = setup({ rules, rows: [], role: opts.role });
	const { staging, objects } = fakeStaging();
	const record = vi.fn(async () => {});
	const unzip = vi.fn(unzipOrProblem);
	const principal: Principal = {
		kind: "user",
		userId: "ana",
		role: opts.role ?? "tenant_member",
	};
	const uploads = createSkillUploads({
		tenantSlug: "acme",
		files: files.deps,
		levelOf: (path) => resolveAccess(rules, principal, path),
		uploadableFolders: uploadableSkillFolders(rules, principal),
		staging,
		unzip,
		reviewUrl: (slug) => `https://agents.test/acme/brain/p/${slug}`,
		record,
	});
	// Lo que hace el cliente con el link: deja el zip bajo la clave de esa persona.
	const put = (uploadId: string, data: Uint8Array, userId = "ana") =>
		objects.set(keyOf({ tenantId: "t1", userId, uploadId }), data);
	return { ...files, staging, objects, record, unzip, uploads, put };
}

async function linked(b: ReturnType<typeof build>, folder = "ventas") {
	const link = await b.uploads.link({ folder });
	const uploadId = link.uploadId as string;
	b.put(uploadId, zip());
	return uploadId;
}

afterEach(() => {
	vi.restoreAllMocks();
});

describe("uploadableSkillFolders", () => {
	it("son las carpetas que la persona administra bajo skills/", () => {
		const member: Principal = {
			kind: "user",
			userId: "ana",
			role: "tenant_member",
		};
		expect(uploadableSkillFolders(ADMIN, member)).toEqual(["ventas"]);
		expect(
			uploadableSkillFolders([members("skills/ventas", "editor")], member),
		).toEqual([]);
		expect(
			uploadableSkillFolders([], { ...member, role: "tenant_admin" }),
		).toEqual([""]);
	});
});

describe("skill_upload_link", () => {
	it("a quien administra la carpeta le da un link de subida con la persona y el tenant del pedido", async () => {
		const b = build();
		const link = await b.uploads.link({ folder: "ventas" });
		expect(link).toMatchObject({
			ok: true,
			method: "PUT",
			contentType: "application/zip",
			maxBytes: MAX_ZIP_BYTES,
			expiresIn: 600,
		});
		const uploadId = link.uploadId as string;
		expect(parseUploadId(uploadId, Date.now())).toEqual({ folder: "ventas" });
		expect(b.staging.issue).toHaveBeenCalledWith({
			tenantId: "t1",
			userId: "ana",
			uploadId,
		});
		expect(link.url).toBe(`https://storage.test/t1/ana/${uploadId}`);
		expect(link.message).toContain("skill_import");
	});

	it("normaliza la carpeta: el prefijo skills/ y las barras de los extremos no cuentan", async () => {
		const b = build();
		const link = await b.uploads.link({ folder: " /skills/ventas/ " });
		expect(parseUploadId(link.uploadId as string, Date.now())).toEqual({
			folder: "ventas",
		});
	});

	it("un administrador de la empresa sube directo bajo skills/", async () => {
		const b = build({ rules: [], role: "tenant_admin" });
		const link = await b.uploads.link({ folder: "" });
		expect(parseUploadId(link.uploadId as string, Date.now())).toEqual({
			folder: "",
		});
	});

	it("un editor de la carpeta, o una carpeta que no administra, responde como si no existiera", async () => {
		const editor = build({ rules: [members("skills/ventas", "editor")] });
		await expect(
			editor.uploads.link({ folder: "ventas" }),
		).rejects.toMatchObject({ code: "not_found" });
		const admin = build();
		await expect(
			admin.uploads.link({ folder: "compras" }),
		).rejects.toMatchObject({ code: "not_found" });
		await expect(admin.uploads.link({ folder: "" })).rejects.toMatchObject({
			code: "not_found",
		});
		expect(editor.staging.issue).not.toHaveBeenCalled();
		expect(admin.staging.issue).not.toHaveBeenCalled();
	});

	it("una carpeta con mayúsculas es un error de validación", async () => {
		const b = build();
		await expect(b.uploads.link({ folder: "Ventas" })).rejects.toMatchObject({
			code: "validation",
		});
		expect(b.staging.issue).not.toHaveBeenCalled();
	});
});

describe("skill_import", () => {
	it("sin confirm devuelve la vista previa y no escribe ni borra el zip", async () => {
		const b = build();
		const uploadId = await linked(b);
		const preview = await b.uploads.import({ uploadId });
		expect(preview).toMatchObject({
			ok: true,
			mode: "crear",
			slug: SLUG,
			name: "facturacion",
			files: [
				{ path: "scripts/calc.py", size: 8 },
				{ path: "references/guia.md", size: 7 },
			],
			warnings: [],
		});
		expect(preview.confirmHint).toContain("confirm");
		// El asistente devuelve lo que mostró: si cambió, no se escribe.
		expect(preview.confirmHint).toContain("expectedMode");
		expect(preview.confirmHint).toContain("expectedSlug");
		expect(b.save).not.toHaveBeenCalled();
		expect(b.putFile).not.toHaveBeenCalled();
		expect(b.staging.remove).not.toHaveBeenCalled();
		expect(b.record).not.toHaveBeenCalled();
		expect(b.objects.size).toBe(1);
	});

	it("con confirm escribe en el borrador, borra el zip y registra la subida por MCP", async () => {
		const b = build();
		const uploadId = await linked(b);
		const result = await b.uploads.import({ uploadId, confirm: true });
		expect(result).toMatchObject({
			ok: true,
			mode: "crear",
			slug: SLUG,
			name: "facturacion",
			files: 2,
			reviewUrl: `https://agents.test/acme/brain/p/${SLUG}`,
		});
		expect(result.message).toMatch(/borrador/);
		expect(b.save).toHaveBeenCalledWith(
			expect.anything(),
			expect.objectContaining({ slug: SLUG, category: "skill" }),
		);
		expect(b.rows.map((row) => row.slug)).toEqual([SLUG]);
		expect(b.putFile).toHaveBeenCalledTimes(2);
		expect(b.staging.remove).toHaveBeenCalledWith({
			tenantId: "t1",
			userId: "ana",
			uploadId,
		});
		expect(b.objects.size).toBe(0);
		expect(b.record).toHaveBeenCalledWith({
			tenantId: "t1",
			userId: "ana",
			channel: "mcp",
			slug: SLUG,
			mode: "crear",
			files: 2,
		});
	});

	it("con expectedMode y expectedSlug distintos de lo que hay ahora: conflicto y nada escrito", async () => {
		const b = build();
		const uploadId = await linked(b);
		// Alguien creó la skill entre la vista previa y la confirmación.
		b.rows.push(skillRow(SLUG, "p9", null));
		await expect(
			b.uploads.import({
				uploadId,
				confirm: true,
				expectedMode: "crear",
				expectedSlug: SLUG,
			}),
		).rejects.toMatchObject({
			code: "conflict",
			message:
				"Cambió desde la vista previa (ahora «reemplazar»). Volvé a abrir la vista previa.",
		});
		expect(b.save).not.toHaveBeenCalled();
		expect(b.putFile).not.toHaveBeenCalled();
		expect(b.record).not.toHaveBeenCalled();
		expect(b.objects.size).toBe(1);
	});

	it("expectedMode sin expectedSlug es un error de validación", async () => {
		const b = build();
		const uploadId = await linked(b);
		await expect(
			b.uploads.import({ uploadId, confirm: true, expectedMode: "crear" }),
		).rejects.toMatchObject({ code: "validation" });
		expect(b.save).not.toHaveBeenCalled();
	});

	it("con expectedMode y expectedSlug iguales escribe", async () => {
		const b = build();
		const uploadId = await linked(b);
		const result = await b.uploads.import({
			uploadId,
			confirm: true,
			expectedMode: "crear",
			expectedSlug: SLUG,
		});
		expect(result).toMatchObject({ ok: true, mode: "crear", slug: SLUG });
	});

	it("si borrar el zip o registrar falla, igual devuelve ok", async () => {
		const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
		const b = build();
		b.staging.remove.mockRejectedValueOnce(new Error("storage caído"));
		b.record.mockRejectedValueOnce(new Error("base caída"));
		const uploadId = await linked(b);
		const result = await b.uploads.import({ uploadId, confirm: true });
		expect(result).toMatchObject({ ok: true, slug: SLUG });
		expect(b.rows.map((row) => row.slug)).toEqual([SLUG]);
		expect(errorLog).toHaveBeenCalledTimes(2);
	});

	it("un paquete inválido no escribe y vuelve como validación", async () => {
		const b = build();
		const { uploadId } = await b.uploads.link({ folder: "ventas" });
		b.put(
			uploadId as string,
			zip("---\ndescription: Sin name.\n---\n\n# Algo\n"),
		);
		await expect(
			b.uploads.import({ uploadId: uploadId as string, confirm: true }),
		).rejects.toMatchObject({ code: "validation" });
		expect(b.save).not.toHaveBeenCalled();
	});

	it("el permiso se revisa al importar: quien ya no administra la carpeta recibe not_found", async () => {
		const b = build({ rules: [members("skills/ventas", "editor")] });
		const uploadId = makeUploadId("ventas", Date.now(), "r");
		b.put(uploadId, zip());
		await expect(b.uploads.import({ uploadId })).rejects.toMatchObject({
			code: "not_found",
		});
		await expect(
			b.uploads.import({ uploadId, confirm: true }),
		).rejects.toMatchObject({ code: "not_found" });
		expect(b.save).not.toHaveBeenCalled();
	});

	describe("rechazos antes de escribir", () => {
		const nothingWritten = (b: ReturnType<typeof build>) => {
			expect(b.save).not.toHaveBeenCalled();
			expect(b.putFile).not.toHaveBeenCalled();
			expect(b.record).not.toHaveBeenCalled();
		};

		it("un uploadId emitido a otra persona no se encuentra", async () => {
			const b = build();
			const uploadId = makeUploadId("ventas", Date.now(), "r");
			b.put(uploadId, zip(), "beto");
			await expect(
				b.uploads.import({ uploadId, confirm: true }),
			).rejects.toMatchObject({ code: "not_found" });
			expect(b.staging.read).toHaveBeenCalledWith({
				tenantId: "t1",
				userId: "ana",
				uploadId,
			});
			nothingWritten(b);
		});

		it("un uploadId que no es un id no se encuentra, sin leer el staging", async () => {
			const b = build();
			await expect(
				b.uploads.import({ uploadId: "basura", confirm: true }),
			).rejects.toMatchObject({ code: "not_found" });
			expect(b.staging.read).not.toHaveBeenCalled();
			nothingWritten(b);
		});

		it("sin zip subido no se encuentra", async () => {
			const b = build();
			const { uploadId } = await b.uploads.link({ folder: "ventas" });
			await expect(
				b.uploads.import({ uploadId: uploadId as string, confirm: true }),
			).rejects.toMatchObject({ code: "not_found" });
			nothingWritten(b);
		});

		it("un link vencido pide otro", async () => {
			const b = build();
			const uploadId = makeUploadId("ventas", Date.now() - 601_000, "r");
			b.put(uploadId, zip());
			await expect(
				b.uploads.import({ uploadId, confirm: true }),
			).rejects.toMatchObject({
				code: "validation",
				message: "El link venció, pedí otro con skill_upload_link.",
			});
			nothingWritten(b);
		});

		it("un zip de más de 4 MB se rechaza sin descomprimirlo", async () => {
			const b = build();
			const uploadId = makeUploadId("ventas", Date.now(), "r");
			b.put(uploadId, new Uint8Array(MAX_ZIP_BYTES + 1));
			await expect(
				b.uploads.import({ uploadId, confirm: true }),
			).rejects.toMatchObject({ code: "validation" });
			expect(b.unzip).not.toHaveBeenCalled();
			nothingWritten(b);
		});

		it("bytes que no son un zip vuelven con el mensaje del descompresor", async () => {
			const b = build();
			const uploadId = makeUploadId("ventas", Date.now(), "r");
			b.put(uploadId, bytes("esto no es un zip"));
			await expect(
				b.uploads.import({ uploadId, confirm: true }),
			).rejects.toMatchObject({
				code: "validation",
				message: "El archivo no es un zip válido.",
			});
			nothingWritten(b);
		});
	});
});
