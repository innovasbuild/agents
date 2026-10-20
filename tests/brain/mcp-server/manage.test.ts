import { describe, expect, it, vi } from "vitest";
import type { AccessRule } from "@/lib/brain/core/access/types";
import type { DeleteParams } from "@/lib/brain/core/delete-store";
import { BrainError } from "@/lib/brain/core/errors";
import {
	administersAnything,
	type BrainManageDeps,
	createBrainManage,
	MAX_DELETE_PER_CALL,
} from "@/lib/brain/core/mcp-server/manage";
import type { BrainPage, BrainRole } from "@/lib/brain/core/types";
import { WikiStoreError } from "@/lib/brain/core/wiki-store";

const page = (
	slug: string,
	body = "texto",
	over: Partial<BrainPage> = {},
): BrainPage => ({
	slug,
	title: slug.split("/").pop() ?? slug,
	category: slug.split("/")[0],
	status: "activo",
	tags: [],
	frontmatter: {},
	body,
	revision: 1,
	updatedAt: "2026-10-20T00:00:00Z",
	...over,
});
const members = (path: string, level: AccessRule["level"]): AccessRule => ({
	path,
	principal: "members",
	userId: null,
	level,
});
const user = (
	path: string,
	userId: string,
	level: AccessRule["level"],
): AccessRule => ({ path, principal: "user", userId, level });

const PAGES = [
	page("marketing/brief"),
	page("marketing/00-reglas"),
	page("marketing/marca/logo"),
	page("marketing/marca/tono", "Ver [[marketing/marca/logo]]"),
	page("comercial/icp"),
];

function setup(
	opts: {
		role?: BrainRole;
		rules?: AccessRule[];
		pages?: BrainPage[];
		deleteError?: (params: DeleteParams) => unknown;
		createError?: (path: string) => unknown;
	} = {},
) {
	const del = vi.fn(async (params: DeleteParams) => {
		const error = opts.deleteError?.(params);
		if (error) throw error;
		return { deletedRevisions: 1, cleaned: 0, rulesRemoved: 0 };
	});
	const create = vi.fn(async (params: { path: string }) => {
		const error = opts.createError?.(params.path);
		if (error) throw error;
	});
	const deps: BrainManageDeps = {
		tenantSlug: "okeefe",
		actor: {
			tenantId: "t1",
			userId: "belisario",
			role: opts.role ?? "tenant_member",
		},
		rules: opts.rules ?? [
			members("", "lector"),
			user("marketing", "belisario", "administrador"),
		],
		bindingId: "b1",
		pages: async () => opts.pages ?? PAGES,
		folders: { create, describe: vi.fn(), remove: vi.fn() },
		deleter: { delete: del },
	};
	return { manage: createBrainManage(deps), del, create };
}

describe("administersAnything", () => {
	const principal = (role: BrainRole) => ({
		kind: "user" as const,
		userId: "belisario",
		role,
	});

	it("un administrador de la empresa siempre", () => {
		expect(administersAnything([], principal("tenant_admin"))).toBe(true);
	});

	it("un miembro con administración sobre una carpeta", () => {
		expect(
			administersAnything(
				[user("marketing", "belisario", "administrador")],
				principal("tenant_member"),
			),
		).toBe(true);
	});

	it("un miembro que solo lee o edita no", () => {
		expect(
			administersAnything(
				[members("", "lector"), user("marketing", "belisario", "editor")],
				principal("tenant_member"),
			),
		).toBe(false);
	});

	it("la administración de otra persona no cuenta", () => {
		expect(
			administersAnything(
				[user("marketing", "otra", "administrador")],
				principal("tenant_member"),
			),
		).toBe(false);
	});
});

describe("createFolders", () => {
	it("crea padre primero aunque la lista venga al revés, heredando el permiso de marketing", async () => {
		const { manage, create } = setup();
		const out = await manage.createFolders({
			folders: [
				{ path: "marketing/marca/identidad-visual" },
				{ path: "marketing/marca", description: "Todo sobre la marca" },
			],
		});
		expect(create.mock.calls.map(([p]) => p.path)).toEqual([
			"marketing/marca",
			"marketing/marca/identidad-visual",
		]);
		expect(create.mock.calls[0][0]).toMatchObject({
			tenantId: "t1",
			actorUserId: "belisario",
			description: "Todo sobre la marca",
		});
		expect(out.results).toEqual([
			{ path: "marketing/marca", ok: true },
			{ path: "marketing/marca/identidad-visual", ok: true },
		]);
	});

	it("una carpeta fuera de lo que administra se rechaza y las demás siguen", async () => {
		const { manage, create } = setup();
		const out = await manage.createFolders({
			folders: [{ path: "comercial/nueva" }, { path: "marketing/campanas" }],
		});
		expect(create).toHaveBeenCalledTimes(1);
		expect(out.results).toEqual([
			expect.objectContaining({
				path: "comercial/nueva",
				ok: false,
				code: "forbidden",
			}),
			{ path: "marketing/campanas", ok: true },
		]);
	});

	it("si falla el padre, el hijo informa su propio error y no frena nada", async () => {
		const { manage } = setup({
			createError: (path) =>
				path === "marketing/marca"
					? new WikiStoreError("BR409", "x", "folder_exists")
					: undefined,
		});
		const out = await manage.createFolders({
			folders: [{ path: "marketing/marca" }, { path: "marketing/marca/logos" }],
		});
		expect(out.results).toEqual([
			expect.objectContaining({
				path: "marketing/marca",
				ok: false,
				code: "conflict",
			}),
			{ path: "marketing/marca/logos", ok: true },
		]);
	});

	it("repite una ruta y la crea una sola vez", async () => {
		const { manage, create } = setup();
		await manage.createFolders({
			folders: [{ path: "marketing/a" }, { path: "marketing/a" }],
		});
		expect(create).toHaveBeenCalledTimes(1);
	});

	it("un nombre inválido no llega a la base", async () => {
		const { manage, create } = setup();
		const out = await manage.createFolders({
			folders: [{ path: "marketing/Mi Carpeta" }],
		});
		expect(create).not.toHaveBeenCalled();
		expect(out.results[0]).toMatchObject({ ok: false, code: "invalid" });
	});
});

describe("delete por slug", () => {
	it("borra una página que la persona administra", async () => {
		const { manage, del } = setup();
		const out = await manage.delete({ slug: "marketing/brief" });
		expect(out).toMatchObject({
			deleted: [{ slug: "marketing/brief", cleaned: 0 }],
			skipped: [],
			remaining: 0,
		});
		expect(del).toHaveBeenCalledWith(
			expect.objectContaining({
				tenantId: "t1",
				slug: "marketing/brief",
				expectedRevision: 1,
				actorUserId: "belisario",
				bindingId: "b1",
			}),
		);
	});

	it("limpia los links que apuntaban a la página", async () => {
		const { manage, del } = setup();
		await manage.delete({ slug: "marketing/marca/logo" });
		const params = del.mock.calls[0][0];
		expect(params.cleanups).toEqual([
			expect.objectContaining({ slug: "marketing/marca/tono" }),
		]);
	});

	it("una página de otra carpeta es forbidden si la ve y not_found si no", async () => {
		const seen = setup();
		await expect(
			seen.manage.delete({ slug: "comercial/icp" }),
		).rejects.toMatchObject({ code: "forbidden" });
		const hidden = setup({
			rules: [
				members("", "lector"),
				members("comercial", "ninguno"),
				user("marketing", "belisario", "administrador"),
			],
		});
		await expect(
			hidden.manage.delete({ slug: "comercial/icp" }),
		).rejects.toMatchObject({ code: "not_found" });
		expect(seen.del).not.toHaveBeenCalled();
	});

	it("una 00-reglas se borra nombrándola, porque administra su carpeta", async () => {
		const { manage, del } = setup();
		await manage.delete({ slug: "marketing/00-reglas" });
		expect(del).toHaveBeenCalledTimes(1);
	});

	it("una skill no se borra por acá", async () => {
		const { manage, del } = setup({
			role: "tenant_admin",
			pages: [page("skills/ventas/guion")],
		});
		await expect(
			manage.delete({ slug: "skills/ventas/guion" }),
		).rejects.toBeInstanceOf(BrainError);
		expect(del).not.toHaveBeenCalled();
	});

	it("una página que no existe responde not_found", async () => {
		const { manage } = setup();
		await expect(
			manage.delete({ slug: "marketing/nada" }),
		).rejects.toMatchObject({ code: "not_found" });
	});

	it("un conflicto de revisión se informa y no se traga", async () => {
		const { manage } = setup({
			deleteError: () => new WikiStoreError("BR409", "x", ""),
		});
		await expect(
			manage.delete({ slug: "marketing/brief" }),
		).rejects.toMatchObject({ code: "conflict" });
	});
});

describe("delete por carpeta", () => {
	it("borra las páginas directas y deja las reservadas y las subcarpetas", async () => {
		const { manage, del } = setup();
		const out = await manage.delete({ folder: "marketing" });
		expect(del.mock.calls.map(([p]) => p.slug)).toEqual(["marketing/brief"]);
		expect(out.deleted).toEqual([{ slug: "marketing/brief", cleaned: 0 }]);
		expect(out.skipped).toEqual([
			{
				slug: "marketing/00-reglas",
				reason: expect.stringContaining("00-reglas"),
			},
		]);
	});

	it("con includeSubfolders baja por todo el árbol", async () => {
		const { manage, del } = setup();
		const out = await manage.delete({
			folder: "marketing",
			includeSubfolders: true,
		});
		expect(del.mock.calls.map(([p]) => p.slug)).toEqual([
			"marketing/brief",
			"marketing/marca/logo",
			"marketing/marca/tono",
		]);
		expect(out.remaining).toBe(0);
	});

	it("no toca páginas de otra carpeta con el mismo prefijo", async () => {
		const { manage, del } = setup({
			role: "tenant_admin",
			pages: [page("marketing/a"), page("marketing-viejo/b")],
		});
		await manage.delete({ folder: "marketing", includeSubfolders: true });
		expect(del.mock.calls.map(([p]) => p.slug)).toEqual(["marketing/a"]);
	});

	it("lo que no administra dentro de la carpeta se saltea con motivo", async () => {
		const { manage, del } = setup({
			rules: [
				members("", "lector"),
				members("marketing", "editor"),
				user("marketing/marca", "belisario", "administrador"),
			],
		});
		const out = await manage.delete({
			folder: "marketing",
			includeSubfolders: true,
		});
		expect(del.mock.calls.map(([p]) => p.slug)).toEqual([
			"marketing/marca/logo",
			"marketing/marca/tono",
		]);
		expect(out.skipped).toContainEqual({
			slug: "marketing/brief",
			reason: expect.stringContaining("administr"),
		});
	});

	it("no nombra páginas que la persona no ve", async () => {
		const { manage, del } = setup({
			pages: [
				page("marketing/brief"),
				page("marketing/interno/plan"),
				page("marketing/marca/logo"),
			],
			rules: [
				members("", "lector"),
				members("marketing/interno", "ninguno"),
				user("marketing/marca", "belisario", "administrador"),
			],
		});
		const out = await manage.delete({
			folder: "marketing",
			includeSubfolders: true,
		});
		expect(del.mock.calls.map(([p]) => p.slug)).toEqual([
			"marketing/marca/logo",
		]);
		expect(JSON.stringify(out)).not.toContain("marketing/interno/plan");
	});

	it("una carpeta que no ve responde not_found", async () => {
		const { manage } = setup({
			rules: [members("", "lector"), members("comercial", "ninguno")],
		});
		await expect(manage.delete({ folder: "comercial" })).rejects.toMatchObject({
			code: "not_found",
		});
	});

	it("un item que falla no frena al resto y se cuenta", async () => {
		const { manage, del } = setup({
			deleteError: (p) =>
				p.slug === "marketing/marca/logo"
					? new WikiStoreError("BR409", "x", "")
					: undefined,
		});
		const out = await manage.delete({
			folder: "marketing/marca",
		});
		expect(del).toHaveBeenCalledTimes(2);
		expect(out.deleted.map((d) => d.slug)).toEqual(["marketing/marca/tono"]);
		expect(out.skipped).toEqual([
			{ slug: "marketing/marca/logo", reason: expect.any(String) },
		]);
	});

	it(`borra hasta ${MAX_DELETE_PER_CALL} por llamada y avisa cuántas quedan`, async () => {
		const many = Array.from({ length: MAX_DELETE_PER_CALL + 7 }, (_, i) =>
			page(`marketing/p${String(i).padStart(3, "0")}`),
		);
		const { manage, del } = setup({ role: "tenant_admin", pages: many });
		const out = await manage.delete({ folder: "marketing" });
		expect(del).toHaveBeenCalledTimes(MAX_DELETE_PER_CALL);
		expect(out.deleted).toHaveLength(MAX_DELETE_PER_CALL);
		expect(out.remaining).toBe(7);
	});

	it("una carpeta sin páginas no borra nada y lo dice", async () => {
		const { manage, del } = setup({ pages: [] });
		const out = await manage.delete({ folder: "marketing" });
		expect(del).not.toHaveBeenCalled();
		expect(out.deleted).toEqual([]);
		expect(out.message).toContain("marketing");
	});

	it("skills/ no se borra por carpeta", async () => {
		const { manage } = setup({ role: "tenant_admin" });
		await expect(manage.delete({ folder: "skills" })).rejects.toBeInstanceOf(
			BrainError,
		);
	});
});

describe("delete: entrada", () => {
	it("pide slug o folder, uno solo", async () => {
		const { manage } = setup();
		await expect(manage.delete({})).rejects.toMatchObject({
			code: "validation",
		});
		await expect(
			manage.delete({ slug: "marketing/brief", folder: "marketing" }),
		).rejects.toMatchObject({ code: "validation" });
	});
});
