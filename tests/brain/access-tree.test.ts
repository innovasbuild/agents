import { describe, expect, it } from "vitest";
import { resolveAccess } from "@/lib/brain/core/access/resolve-access";
import {
	editableFolders,
	visibleTree,
	withoutArchived,
} from "@/lib/brain/core/access/tree";
import type { AccessRule, Principal } from "@/lib/brain/core/access/types";

const ana: Principal = {
	kind: "user",
	userId: "ana",
	role: "tenant_member",
};
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

const page = (
	slug: string,
	status: "activo" | "borrador" | "archivado" = "activo",
) => ({
	slug,
	title: slug.split("/").pop() ?? slug,
	status,
	body: "contenido que no debe viajar",
	tags: [],
});
const accessFor =
	(rules: AccessRule[], who: Principal = ana) =>
	(path: string) =>
		resolveAccess(rules, who, path);

describe("visibleTree", () => {
	it("una persona con acceso a una sola página profunda ve la carpeta con esa hoja y nada más", () => {
		const rules = [
			members("", "lector"),
			members("direccion", "ninguno"),
			user("direccion/presupuesto-2027", "ana", "editor"),
		];
		const tree = visibleTree(
			[
				page("comercial/icp"),
				page("direccion/estrategia"),
				page("direccion/presupuesto-2027"),
			],
			accessFor(rules),
		);
		expect(tree.children.map((n) => n.name)).toEqual([
			"comercial",
			"direccion",
		]);
		const direccion = tree.children[1];
		expect(direccion.level).toBeNull();
		expect(direccion.children.map((n) => n.path)).toEqual([
			"direccion/presupuesto-2027",
		]);
		expect(direccion.children[0].level).toBe("editor");
	});

	it("una página y una carpeta con el mismo nombre son un solo nodo", () => {
		const tree = visibleTree(
			[page("comercial/icp"), page("comercial/icp/objeciones")],
			accessFor([members("", "lector")]),
		);
		const icp = tree.children[0].children[0];
		expect(icp.path).toBe("comercial/icp");
		expect(icp.page?.slug).toBe("comercial/icp");
		expect(icp.children.map((n) => n.path)).toEqual([
			"comercial/icp/objeciones",
		]);
	});

	it("ordena primero lo que tiene hijos y después por nombre", () => {
		const tree = visibleTree(
			[page("zeta"), page("alfa"), page("carpeta/uno")],
			accessFor([members("", "lector")]),
		);
		expect(tree.children.map((n) => n.name)).toEqual([
			"carpeta",
			"alfa",
			"zeta",
		]);
	});

	it("no copia el cuerpo ni los demás campos de la página", () => {
		const tree = visibleTree(
			[page("comercial/icp")],
			accessFor([members("", "lector")]),
		);
		const leaf = tree.children[0].children[0];
		expect(leaf.page).toEqual({
			slug: "comercial/icp",
			title: "icp",
			status: "activo",
		});
		expect(JSON.stringify(tree)).not.toContain("contenido que no debe viajar");
	});

	it("un administrador ve todo con nivel administrador", () => {
		const admin: Principal = {
			kind: "user",
			userId: "x",
			role: "tenant_admin",
		};
		const tree = visibleTree([page("a/b")], accessFor([], admin));
		expect(tree.level).toBe("administrador");
		expect(tree.children[0].level).toBe("administrador");
	});
});

describe("withoutArchived", () => {
	it("saca las archivadas y las carpetas que quedan vacías", () => {
		const tree = visibleTree(
			[
				page("vieja/a", "archivado"),
				page("mixta/a", "archivado"),
				page("mixta/b"),
			],
			accessFor([members("", "lector")]),
		);
		const clean = withoutArchived(tree);
		expect(clean.children.map((n) => n.name)).toEqual(["mixta"]);
		expect(clean.children[0].children.map((n) => n.name)).toEqual(["b"]);
	});

	it("una página archivada con hijos activos queda como carpeta sin página", () => {
		const tree = visibleTree(
			[page("x", "archivado"), page("x/y")],
			accessFor([members("", "lector")]),
		);
		const x = withoutArchived(tree).children[0];
		expect(x.page).toBeNull();
		expect(x.children.map((n) => n.path)).toEqual(["x/y"]);
	});
});

describe("editableFolders", () => {
	it("lista la raíz y las carpetas donde la persona es editor", () => {
		const rules = [members("", "lector"), user("comercial", "ana", "editor")];
		const tree = visibleTree(
			[page("comercial/icp"), page("legal/contrato"), page("suelta")],
			accessFor(rules),
		);
		expect(editableFolders(tree)).toEqual(["comercial"]);
	});

	it("incluye la raíz si es editor de ella", () => {
		const tree = visibleTree([page("a/b")], accessFor([members("", "editor")]));
		expect(editableFolders(tree)).toEqual(["", "a"]);
	});
});
