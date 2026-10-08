import { describe, expect, it, vi } from "vitest";
import type { AccessRule } from "@/lib/brain/core/access/types";
import type { DeleteParams } from "@/lib/brain/core/delete-store";
import {
	type DeleteDeps,
	deletePage,
	previewDelete,
} from "@/lib/brain/core/editor/delete";
import type { BrainPage, BrainRole } from "@/lib/brain/core/types";
import { WikiStoreError } from "@/lib/brain/core/wiki-store";

const page = (
	slug: string,
	body: string,
	over: Partial<BrainPage> = {},
): BrainPage => ({
	slug,
	title: slug.split("/").pop() ?? slug,
	category: "comercial",
	status: "activo",
	tags: [],
	frontmatter: {},
	body,
	revision: 3,
	updatedAt: "2026-10-08T00:00:00Z",
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
): AccessRule => ({
	path,
	principal: "user",
	userId,
	level,
});

const PAGES = [
	page("comercial/icp", "texto", { tags: ["canon:icp"], title: "ICP" }),
	page("comercial/icp/objeciones", "hijo"),
	page("legal/contrato", "Ver [[comercial/icp|el perfil]]."),
	page("direccion/secreta", "Ver [[comercial/icp]]."),
	page("suelta", "nada"),
];

function setup(
	opts: {
		role?: BrainRole;
		userId?: string;
		rules?: AccessRule[];
		pages?: BrainPage[];
		provider?: "wiki" | "mcp";
		hasBinding?: boolean;
		deleterError?: unknown;
	} = {},
) {
	const del = vi.fn(async (_params: DeleteParams) => {
		if (opts.deleterError) throw opts.deleterError;
		return { deletedRevisions: 4, cleaned: 2, rulesRemoved: 0 };
	});
	const deps: DeleteDeps = {
		actor: async () => ({
			tenantId: "t1",
			userId: opts.userId ?? "admin1",
			role: opts.role ?? "tenant_admin",
		}),
		rules: { load: async () => opts.rules ?? [members("", "lector")] },
		binding: async () =>
			opts.hasBinding === false
				? null
				: { id: "b1", provider: opts.provider ?? "wiki" },
		pages: async () => opts.pages ?? PAGES,
		deleter: { delete: del },
	};
	return { deps, del };
}

const MEMBER_OF_COMERCIAL = {
	role: "tenant_member" as const,
	userId: "beto",
	rules: [
		members("", "lector"),
		members("direccion", "ninguno"),
		user("comercial", "beto", "administrador"),
	],
};

describe("previewDelete", () => {
	it("un administrador del tenant recibe el resumen con todas las que enlazan", async () => {
		const { deps } = setup();
		const result = await previewDelete("i", "comercial/icp", deps);
		expect(result).toMatchObject({
			ok: true,
			preview: {
				slug: "comercial/icp",
				title: "ICP",
				revision: 3,
				hasChildren: true,
				canonTags: ["canon:icp"],
				hiddenLinkers: 0,
			},
		});
		if (result.ok) {
			expect(result.preview.linkers.map((l) => l.slug).sort()).toEqual([
				"direccion/secreta",
				"legal/contrato",
			]);
		}
	});

	it("a un administrador de nodo le muestra las que ve y solo cuenta las ocultas, sin rutas ni títulos", async () => {
		const { deps } = setup(MEMBER_OF_COMERCIAL);
		const result = await previewDelete("i", "comercial/icp", deps);
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.preview.linkers.map((l) => l.slug)).toEqual([
			"legal/contrato",
		]);
		expect(result.preview.hiddenLinkers).toBe(1);
		expect(JSON.stringify(result)).not.toContain("direccion");
		expect(JSON.stringify(result)).not.toContain("secreta");
	});

	it("quien no ve la página recibe not_found; quien la ve sin administrarla, forbidden", async () => {
		const hidden = setup({
			role: "tenant_member",
			userId: "ana",
			rules: [members("", "lector"), members("comercial", "ninguno")],
		});
		expect(
			await previewDelete("i", "comercial/icp", hidden.deps),
		).toMatchObject({
			ok: false,
			code: "not_found",
		});
		const visible = setup({ role: "tenant_member", userId: "ana" });
		expect(
			await previewDelete("i", "comercial/icp", visible.deps),
		).toMatchObject({
			ok: false,
			code: "forbidden",
		});
	});

	it("una página que no existe, un slug inválido y un tenant sin sesión responden not_found", async () => {
		const { deps } = setup();
		expect(await previewDelete("i", "no-existe", deps)).toMatchObject({
			code: "not_found",
		});
		expect(await previewDelete("i", "../x", deps)).toMatchObject({
			code: "not_found",
		});
		deps.actor = async () => null;
		expect(await previewDelete("i", "comercial/icp", deps)).toMatchObject({
			code: "not_found",
		});
	});

	it("sin brain es not_found y con un brain externo (mcp) es unsupported", async () => {
		expect(
			await previewDelete(
				"i",
				"comercial/icp",
				setup({ hasBinding: false }).deps,
			),
		).toMatchObject({ code: "not_found" });
		expect(
			await previewDelete(
				"i",
				"comercial/icp",
				setup({ provider: "mcp" }).deps,
			),
		).toMatchObject({ ok: false, code: "unsupported" });
	});

	it("si las reglas no se pueden cargar, lanza: falla cerrada", async () => {
		const { deps } = setup({ role: "tenant_member", userId: "ana" });
		deps.rules = {
			load: async () => {
				throw new Error("base caída");
			},
		};
		await expect(previewDelete("i", "comercial/icp", deps)).rejects.toThrow(
			/base caída/,
		);
	});

	it("hasChildren cuenta solo las hijas que la persona ve", async () => {
		const rules = [
			members("", "lector"),
			members("comercial/icp", "administrador"),
			members("comercial/icp/secreta", "ninguno"),
		];
		const base = [page("comercial/icp", "texto", { title: "ICP" })];
		const onlyHidden = setup({
			role: "tenant_member",
			userId: "ana",
			rules,
			pages: [...base, page("comercial/icp/secreta", "oculta")],
		});
		const hidden = await previewDelete("i", "comercial/icp", onlyHidden.deps);
		expect(hidden).toMatchObject({
			ok: true,
			preview: { hasChildren: false },
		});
		const withVisible = setup({
			role: "tenant_member",
			userId: "ana",
			rules,
			pages: [
				...base,
				page("comercial/icp/secreta", "oculta"),
				page("comercial/icp/objeciones", "hijo"),
			],
		});
		expect(
			await previewDelete("i", "comercial/icp", withVisible.deps),
		).toMatchObject({ ok: true, preview: { hasChildren: true } });
	});

	it("quien administra solo otro nodo recibe forbidden", async () => {
		const { deps } = setup({
			role: "tenant_member",
			userId: "beto",
			rules: [members("", "lector"), user("legal", "beto", "administrador")],
		});
		expect(await previewDelete("i", "comercial/icp", deps)).toMatchObject({
			ok: false,
			code: "forbidden",
		});
	});

	it("una página sin hijos ni etiquetas de canon lo dice", async () => {
		const { deps } = setup();
		const result = await previewDelete("i", "suelta", deps);
		expect(result).toMatchObject({
			ok: true,
			preview: {
				hasChildren: false,
				canonTags: [],
				linkers: [],
				hiddenLinkers: 0,
			},
		});
	});
});

describe("deletePage", () => {
	it("arma el plan en el servidor y llama al escritor con la revisión esperada", async () => {
		const { deps, del } = setup();
		const result = await deletePage("i", "comercial/icp", 3, deps);
		expect(result).toEqual({ ok: true, cleaned: 2 });
		expect(del).toHaveBeenCalledWith({
			tenantId: "t1",
			slug: "comercial/icp",
			expectedRevision: 3,
			actorUserId: "admin1",
			bindingId: "b1",
			cleanups: [
				{ slug: "legal/contrato", baseRevision: 3, body: "Ver el perfil." },
				{ slug: "direccion/secreta", baseRevision: 3, body: "Ver ICP." },
			],
		});
	});

	it("limpia también las páginas que quien borra no ve", async () => {
		const { deps, del } = setup(MEMBER_OF_COMERCIAL);
		await deletePage("i", "comercial/icp", 3, deps);
		const sent = del.mock.calls[0][0].cleanups.map(
			(c: { slug: string }) => c.slug,
		);
		expect(sent).toContain("direccion/secreta");
	});

	it("quien no administra el nodo no borra nada", async () => {
		const { deps, del } = setup({ role: "tenant_member", userId: "ana" });
		expect(await deletePage("i", "comercial/icp", 3, deps)).toMatchObject({
			ok: false,
			code: "forbidden",
		});
		expect(del).not.toHaveBeenCalled();
	});

	it("quien administra solo otro nodo no borra nada", async () => {
		const { deps, del } = setup({
			role: "tenant_member",
			userId: "beto",
			rules: [members("", "lector"), user("legal", "beto", "administrador")],
		});
		expect(await deletePage("i", "comercial/icp", 3, deps)).toMatchObject({
			ok: false,
			code: "forbidden",
		});
		expect(del).not.toHaveBeenCalled();
	});

	it("una página que la persona no ve responde not_found y no borra", async () => {
		const { deps, del } = setup({
			role: "tenant_member",
			userId: "ana",
			rules: [members("", "lector"), members("comercial", "ninguno")],
		});
		expect(await deletePage("i", "comercial/icp", 3, deps)).toMatchObject({
			ok: false,
			code: "not_found",
		});
		expect(del).not.toHaveBeenCalled();
	});

	it("un conflicto de la base responde conflict; una página que ya no está, not_found", async () => {
		const conflict = setup({
			deleterError: new WikiStoreError("BR409", "BRAIN_CONFLICT", "5"),
		});
		expect(
			await deletePage("i", "comercial/icp", 3, conflict.deps),
		).toMatchObject({
			ok: false,
			code: "conflict",
		});
		const gone = setup({
			deleterError: new WikiStoreError(
				"BR404",
				"BRAIN_NOT_FOUND",
				"comercial/icp",
			),
		});
		expect(await deletePage("i", "comercial/icp", 3, gone.deps)).toMatchObject({
			code: "not_found",
		});
	});

	it("un deadlock revertido por Postgres (40P01) responde conflict", async () => {
		const { deps } = setup({
			deleterError: new WikiStoreError("40P01", "deadlock detected", ""),
		});
		expect(await deletePage("i", "comercial/icp", 3, deps)).toMatchObject({
			ok: false,
			code: "conflict",
		});
	});

	it("cualquier otro error del escritor se propaga", async () => {
		const { deps } = setup({ deleterError: new Error("red caída") });
		await expect(deletePage("i", "comercial/icp", 3, deps)).rejects.toThrow(
			/red caída/,
		);
	});

	it("con un brain externo no escribe", async () => {
		const { deps, del } = setup({ provider: "mcp" });
		expect(await deletePage("i", "comercial/icp", 3, deps)).toMatchObject({
			code: "unsupported",
		});
		expect(del).not.toHaveBeenCalled();
	});
});
