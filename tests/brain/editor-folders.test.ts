import { describe, expect, it, vi } from "vitest";
import type { AccessRule } from "@/lib/brain/core/access/types";
import {
	createFolder,
	deleteFolder,
	describeFolder,
	type FolderDeps,
} from "@/lib/brain/core/editor/folders";
import { WikiStoreError } from "@/lib/brain/core/wiki-store";

function deps(
	role: string,
	rules: AccessRule[] = [],
	overrides: Partial<FolderDeps> = {},
): FolderDeps {
	return {
		actor: async () => ({ tenantId: "t", userId: "u", role: role as never }),
		rules: { load: vi.fn(async () => rules) } as never,
		binding: async () => ({ id: "b", provider: "wiki" }),
		writer: {
			create: vi.fn(async () => {}),
			describe: vi.fn(async () => {}),
			remove: vi.fn(async () => {}),
		},
		...overrides,
	};
}

describe("createFolder", () => {
	it("un admin de la empresa crea una de primer nivel", async () => {
		const d = deps("tenant_admin");
		expect(
			await createFolder("okeefe", "marketing", "Marca y pauta", d),
		).toEqual({ ok: true });
		expect(d.writer.create).toHaveBeenCalledWith({
			tenantId: "t",
			actorUserId: "u",
			path: "marketing",
			description: "Marca y pauta",
		});
	});

	it("un miembro sin administración no crea", async () => {
		// Sin reglas el miembro lee la raíz: la ve, así que es forbidden.
		const d = deps("tenant_member");
		expect(await createFolder("okeefe", "marketing", "", d)).toMatchObject({
			ok: false,
			code: "forbidden",
		});
		expect(d.writer.create).not.toHaveBeenCalled();
	});

	it("un miembro que no ve la raíz recibe not_found", async () => {
		const rules = [
			{ path: "", principal: "members", userId: null, level: "ninguno" },
		] as unknown as AccessRule[];
		expect(
			await createFolder(
				"okeefe",
				"marketing",
				"",
				deps("tenant_member", rules),
			),
		).toMatchObject({ ok: false, code: "not_found" });
	});

	it("falla cerrada si no se pueden cargar las reglas", async () => {
		const d = deps("tenant_member", [], {
			rules: { load: vi.fn(async () => Promise.reject(new Error("db"))) },
		});
		await expect(createFolder("okeefe", "marketing", "", d)).rejects.toThrow(
			"db",
		);
		expect(d.writer.create).not.toHaveBeenCalled();
	});

	it("crear una de primer nivel exige administrar la raíz, no la carpeta", async () => {
		const rules = [
			{
				path: "marketing",
				principal: "user",
				userId: "u",
				level: "administrador",
			},
		] as unknown as AccessRule[];
		expect(
			await createFolder(
				"okeefe",
				"marketing",
				"",
				deps("tenant_member", rules),
			),
		).toMatchObject({ code: "forbidden" });
	});

	it("un miembro administrador de comercial crea una subcarpeta ahí", async () => {
		const rules = [
			{
				path: "comercial",
				principal: "user",
				userId: "u",
				level: "administrador",
			},
		] as unknown as AccessRule[];
		expect(
			await createFolder(
				"okeefe",
				"comercial/sucursales",
				"",
				deps("tenant_member", rules),
			),
		).toEqual({ ok: true });
	});

	it("valida la ruta y la descripción antes de escribir", async () => {
		const d = deps("tenant_admin");
		expect(await createFolder("okeefe", "Mal Nombre", "", d)).toMatchObject({
			code: "invalid",
		});
		expect(
			await createFolder("okeefe", "ok", "x".repeat(301), d),
		).toMatchObject({
			code: "invalid",
		});
		expect(d.writer.create).not.toHaveBeenCalled();
	});

	it("traduce los errores de la base", async () => {
		const failing = (detail: string, code = "BR409") =>
			deps("tenant_admin", [], {
				writer: {
					create: vi.fn(async () => {
						throw new WikiStoreError(code, "x", detail);
					}),
					describe: vi.fn(),
					remove: vi.fn(),
				},
			});
		expect(
			await createFolder("okeefe", "comercial", "", failing("folder_exists")),
		).toMatchObject({
			code: "conflict",
			message: expect.stringContaining("Ya existe"),
		});
		expect(
			await createFolder("okeefe", "a/b", "", failing("parent", "BR404")),
		).toMatchObject({ code: "not_found" });
		expect(
			await createFolder("okeefe", "otra", "", failing("too_many", "BR422")),
		).toMatchObject({
			code: "invalid",
			message: expect.stringContaining("20"),
		});
	});

	it("un brain externo no tiene carpetas", async () => {
		const d = deps("tenant_admin", [], {
			binding: async () => ({ id: "b", provider: "mcp" }),
		});
		expect(await createFolder("okeefe", "x", "", d)).toMatchObject({
			code: "unsupported",
		});
	});
});

describe("describeFolder y deleteFolder", () => {
	it("describir exige administrar la carpeta", async () => {
		const rules = [
			{ path: "comercial", principal: "user", userId: "u", level: "editor" },
		] as unknown as AccessRule[];
		expect(
			await describeFolder(
				"okeefe",
				"comercial",
				"x",
				deps("tenant_member", rules),
			),
		).toMatchObject({ code: "forbidden" });
	});

	it("borrar una de primer nivel exige administrar la raíz", async () => {
		const rules = [
			{
				path: "comercial",
				principal: "user",
				userId: "u",
				level: "administrador",
			},
		] as unknown as AccessRule[];
		const d = deps("tenant_member", rules);
		expect(await deleteFolder("okeefe", "comercial", d)).toMatchObject({
			code: "forbidden",
		});
		expect(await deleteFolder("okeefe", "comercial/sucursales", d)).toEqual({
			ok: true,
		});
		expect(d.writer.remove).toHaveBeenCalledTimes(1);
	});

	it("borrar una no vacía devuelve el motivo", async () => {
		const d = deps("tenant_admin", [], {
			writer: {
				create: vi.fn(),
				describe: vi.fn(),
				remove: vi.fn(async () => {
					throw new WikiStoreError("BR409", "x", "folder_not_empty");
				}),
			},
		});
		expect(await deleteFolder("okeefe", "comercial", d)).toMatchObject({
			code: "conflict",
			message: expect.stringContaining("vacía"),
		});
	});

	it("borrar la última de primer nivel devuelve el motivo", async () => {
		const d = deps("tenant_admin", [], {
			writer: {
				create: vi.fn(),
				describe: vi.fn(),
				remove: vi.fn(async () => {
					throw new WikiStoreError("BR409", "x", "folder_last");
				}),
			},
		});
		expect(await deleteFolder("okeefe", "empresa", d)).toMatchObject({
			code: "conflict",
			message: expect.stringContaining("al menos una"),
		});
	});
});
