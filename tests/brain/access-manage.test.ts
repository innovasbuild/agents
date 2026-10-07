import { describe, expect, it, vi } from "vitest";
import {
	type AccessChange,
	applyChange,
	changeAccess,
	loadShareView,
	type ManageDeps,
} from "@/lib/brain/core/access/manage";
import type { AccessRule } from "@/lib/brain/core/access/types";
import type { BrainRole } from "@/lib/brain/core/types";

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

function setup(opts: {
	rules?: AccessRule[];
	role?: BrainRole;
	userId?: string;
	roles?: Record<string, BrainRole>;
	paths?: string[];
}) {
	const rules = opts.rules ?? [members("", "lector")];
	const set = vi.fn(async () => {});
	const remove = vi.fn(async () => {});
	const deps: ManageDeps = {
		actor: async () => ({
			tenantId: "t1",
			userId: opts.userId ?? "admin1",
			role: opts.role ?? "tenant_admin",
		}),
		rules: { load: async () => rules, set, remove },
		memberRole: async (_t, id) =>
			(opts.roles ?? { ana: "tenant_member", beto: "tenant_member" })[id] ??
			null,
		pagePaths: async () => opts.paths ?? ["comercial/icp", "legal/contrato"],
	};
	return { deps, set, remove };
}

const grant = (
	over: {
		path?: string;
		userId?: string;
		level?: "lector" | "editor" | "administrador";
	} = {},
): AccessChange => ({
	kind: "grant",
	path: "comercial",
	userId: "ana",
	level: "lector",
	...over,
});

describe("applyChange", () => {
	it("grant reemplaza la regla de esa persona en ese nodo y no toca las demás", () => {
		const rules = [user("a", "ana", "lector"), user("b", "ana", "editor")];
		expect(
			applyChange(rules, {
				kind: "grant",
				path: "a",
				userId: "ana",
				level: "editor",
			}),
		).toEqual([user("b", "ana", "editor"), user("a", "ana", "editor")]);
	});

	it("general inherit borra la fila members del nodo", () => {
		const rules = [members("a", "ninguno"), members("", "lector")];
		expect(
			applyChange(rules, { kind: "general", path: "a", level: "inherit" }),
		).toEqual([members("", "lector")]);
	});
});

describe("changeAccess", () => {
	it("un administrador da acceso a un miembro y se escribe la regla", async () => {
		const { deps, set } = setup({});
		expect(await changeAccess("innovas", grant(), deps)).toEqual({ ok: true });
		expect(set).toHaveBeenCalledWith(
			"t1",
			{ path: "comercial", principal: "user", userId: "ana", level: "lector" },
			"admin1",
		);
	});

	it("revoke quita la regla de esa persona", async () => {
		const { deps, remove } = setup({});
		await changeAccess(
			"innovas",
			{ kind: "revoke", path: "comercial", userId: "ana" },
			deps,
		);
		expect(remove).toHaveBeenCalledWith(
			"t1",
			{ path: "comercial", principal: "user", userId: "ana" },
			"admin1",
		);
	});

	it("general inherit quita la fila members; un nivel la escribe", async () => {
		const { deps, set, remove } = setup({});
		await changeAccess(
			"innovas",
			{ kind: "general", path: "legal", level: "inherit" },
			deps,
		);
		expect(remove).toHaveBeenCalledWith(
			"t1",
			{ path: "legal", principal: "members", userId: null },
			"admin1",
		);
		await changeAccess(
			"innovas",
			{ kind: "general", path: "legal", level: "ninguno" },
			deps,
		);
		expect(set).toHaveBeenCalledWith(
			"t1",
			{ path: "legal", principal: "members", userId: null, level: "ninguno" },
			"admin1",
		);
	});

	it("inherit sobre la raíz se rechaza", async () => {
		const { deps, remove } = setup({});
		const result = await changeAccess(
			"innovas",
			{ kind: "general", path: "", level: "inherit" },
			deps,
		);
		expect(result).toMatchObject({ ok: false, code: "invalid" });
		expect(remove).not.toHaveBeenCalled();
	});

	it("sin sesión del tenant responde not_found", async () => {
		const { deps } = setup({});
		deps.actor = async () => null;
		expect(await changeAccess("x", grant(), deps)).toMatchObject({
			code: "not_found",
		});
	});

	it("un miembro que no ve el nodo recibe not_found; uno que lo ve sin administrar, forbidden", async () => {
		const hidden = setup({
			role: "tenant_member",
			userId: "beto",
			rules: [members("", "lector"), members("comercial", "ninguno")],
		});
		expect(await changeAccess("i", grant(), hidden.deps)).toMatchObject({
			code: "not_found",
		});

		const visible = setup({ role: "tenant_member", userId: "beto" });
		expect(await changeAccess("i", grant(), visible.deps)).toMatchObject({
			code: "forbidden",
		});
		expect(visible.set).not.toHaveBeenCalled();
	});

	it("un miembro administrador del nodo puede dar acceso", async () => {
		const { deps, set } = setup({
			role: "tenant_member",
			userId: "beto",
			rules: [
				members("", "lector"),
				user("comercial", "beto", "administrador"),
			],
		});
		expect(await changeAccess("i", grant(), deps)).toEqual({ ok: true });
		expect(set).toHaveBeenCalled();
	});

	it("un miembro administrador no puede quitarse ni bajarse la regla propia", async () => {
		const rules = [
			members("", "lector"),
			user("comercial", "beto", "administrador"),
		];
		const a = setup({ role: "tenant_member", userId: "beto", rules });
		expect(
			await changeAccess(
				"i",
				{ kind: "revoke", path: "comercial", userId: "beto" },
				a.deps,
			),
		).toMatchObject({ ok: false, code: "lockout" });
		expect(a.remove).not.toHaveBeenCalled();

		const b = setup({ role: "tenant_member", userId: "beto", rules });
		expect(
			await changeAccess(
				"i",
				{ kind: "grant", path: "comercial", userId: "beto", level: "editor" },
				b.deps,
			),
		).toMatchObject({ ok: false, code: "lockout" });
		expect(b.set).not.toHaveBeenCalled();
	});

	it("un miembro administrador por acceso general no puede restringirse a sí mismo", async () => {
		const { deps, set } = setup({
			role: "tenant_member",
			userId: "beto",
			rules: [
				members("", "lector"),
				members("comercial", "administrador" as never),
			],
		});
		expect(
			await changeAccess(
				"i",
				{ kind: "general", path: "comercial", level: "ninguno" },
				deps,
			),
		).toMatchObject({ ok: false, code: "lockout" });
		expect(set).not.toHaveBeenCalled();
	});

	it("un tenant_admin sí puede cambiar cualquier cosa, incluida la regla de otro administrador de nodo", async () => {
		const { deps, remove } = setup({
			rules: [
				members("", "lector"),
				user("comercial", "beto", "administrador"),
			],
			roles: { beto: "tenant_member" },
		});
		expect(
			await changeAccess(
				"i",
				{ kind: "revoke", path: "comercial", userId: "beto" },
				deps,
			),
		).toEqual({ ok: true });
		expect(remove).toHaveBeenCalled();
	});

	it("rechaza a quien no es miembro del tenant, a un tenant_admin y a un userId inexistente", async () => {
		const { deps, set } = setup({
			roles: { ana: "tenant_member", adm: "tenant_admin" },
		});
		expect(
			await changeAccess("i", grant({ userId: "extraño" }), deps),
		).toMatchObject({ code: "invalid" });
		expect(
			await changeAccess("i", grant({ userId: "adm" }), deps),
		).toMatchObject({ code: "invalid" });
		expect(set).not.toHaveBeenCalled();
	});

	it("una ruta inventada, sin páginas ni reglas debajo, responde not_found", async () => {
		const { deps, set } = setup({});
		expect(
			await changeAccess("i", grant({ path: "no-existe" }), deps),
		).toMatchObject({ code: "not_found" });
		expect(set).not.toHaveBeenCalled();
	});

	it("una ruta con reglas pero sin páginas sí existe; una ruta mal formada es invalid", async () => {
		const withRule = setup({
			rules: [members("", "lector"), members("vacia", "ninguno")],
		});
		expect(
			await changeAccess("i", grant({ path: "vacia" }), withRule.deps),
		).toEqual({ ok: true });
		const { deps } = setup({});
		expect(
			await changeAccess("i", grant({ path: "../x" }), deps),
		).toMatchObject({ code: "invalid" });
		expect(await changeAccess("i", grant({ path: "A/B" }), deps)).toMatchObject(
			{ code: "invalid" },
		);
	});

	it("si las reglas no se pueden cargar, lanza: falla cerrada", async () => {
		const { deps } = setup({});
		deps.rules.load = async () => {
			throw new Error("base caída");
		};
		await expect(changeAccess("i", grant(), deps)).rejects.toThrow(
			/base caída/,
		);
	});
});

describe("loadShareView", () => {
	it("un administrador del nodo recibe la vista", async () => {
		const { deps } = setup({
			rules: [members("", "lector"), user("comercial", "ana", "editor")],
		});
		const result = await loadShareView("i", "comercial", deps);
		expect(result).toMatchObject({
			ok: true,
			view: { path: "comercial", own: [{ userId: "ana", level: "editor" }] },
		});
	});

	it("un miembro sin administración no la recibe", async () => {
		const { deps } = setup({ role: "tenant_member", userId: "beto" });
		expect(await loadShareView("i", "comercial", deps)).toMatchObject({
			ok: false,
			code: "forbidden",
		});
	});
});
