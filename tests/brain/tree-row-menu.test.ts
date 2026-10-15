import { describe, expect, it } from "vitest";
import {
	folderMenuItems,
	rulesMenuLabel,
} from "@/components/brain/tree-row-menu";
import {
	type TreeNode,
	visibleTree,
	withoutArchived,
} from "@/lib/brain/core/access/tree";
import { rulesEntryHref } from "@/lib/brain/core/editor/reserved";
import { nodeBuiltins } from "./client-safe";

const node = (over: Partial<TreeNode>): TreeNode => ({
	path: "comercial",
	name: "comercial",
	page: null,
	folder: { description: "" },
	rules: null,
	template: null,
	level: "administrador",
	children: [],
	...over,
});

describe("folderMenuItems", () => {
	it("un administrador de la raíz ve las acciones de carpeta", () => {
		expect(folderMenuItems(node({}), "administrador", null)).toEqual([
			"new-subfolder",
			"describe",
			"rules",
			"delete-folder",
		]);
	});
	it("un editor no ve ninguna", () => {
		expect(
			folderMenuItems(node({ level: "editor" }), "administrador", null),
		).toEqual([]);
	});
	// Antes ofrecía "Nueva subcarpeta" acá: brain_create_folder pide la fila del
	// padre y respondía siempre no encontrado.
	it("una carpeta implícita (sin fila) no ofrece nada", () => {
		expect(
			folderMenuItems(
				node({ folder: null, children: [node({ path: "comercial/x" })] }),
				"administrador",
				null,
			),
		).toEqual([]);
	});
	it("la raíz ofrece nueva carpeta e instrucciones del brain", () => {
		const root = node({ path: "", name: "", folder: null });
		expect(folderMenuItems(root, "administrador", null)).toEqual([
			"new-subfolder",
			"rules",
		]);
		expect(rulesMenuLabel(root)).toBe("Instrucciones del brain");
		expect(rulesMenuLabel(node({}))).toBe("Reglas de la carpeta");
	});
	it("una de primer nivel no se borra si no administra la raíz", () => {
		expect(folderMenuItems(node({}), "editor", null)).toEqual([
			"new-subfolder",
			"describe",
			"rules",
		]);
	});
	it("una subcarpeta se borra administrando solo esa carpeta", () => {
		expect(
			folderMenuItems(
				node({ path: "comercial/sucursales", name: "sucursales" }),
				"lector",
				null,
			),
		).toEqual(["new-subfolder", "describe", "rules", "delete-folder"]);
	});
	it("skills/ no ofrece reglas propias", () => {
		expect(
			folderMenuItems(
				node({ path: "skills", name: "skills" }),
				"administrador",
				null,
			),
		).toEqual(["new-subfolder", "describe", "delete-folder"]);
		expect(
			folderMenuItems(
				node({ path: "skills/ventas", name: "ventas" }),
				"administrador",
				null,
			),
		).toEqual(["new-subfolder", "describe", "delete-folder"]);
	});
	it("con contenido, borrar aparece deshabilitado", () => {
		expect(
			folderMenuItems(
				node({}),
				"administrador",
				"Tiene páginas o subcarpetas.",
			),
		).toEqual(["new-subfolder", "describe", "rules", "delete-folder-blocked"]);
	});
});

describe("reglas desde el árbol", () => {
	it("una 00-reglas archivada no muestra la marca pero el menú la abre", () => {
		const root = visibleTree(
			[
				{
					slug: "comercial/00-reglas",
					title: "Reglas",
					status: "archivado",
				},
			],
			() => "administrador",
			[{ path: "comercial", description: "" }],
		);
		const comercial = withoutArchived(root).children[0];
		expect(comercial.rules?.status === "activo").toBe(false);
		expect(rulesEntryHref("acme", comercial)).toBe(
			"/acme/brain/p/comercial/00-reglas",
		);
	});

	it("sin 00-reglas, el menú de la raíz crea las instrucciones", () => {
		const root = visibleTree([], () => "administrador", []);
		expect(rulesEntryHref("acme", root)).toBe("/acme/brain/nueva?reglas=1");
	});
});

describe("frontera de cliente", () => {
	it("el menú y el árbol no arrastran node:*", () => {
		expect(nodeBuiltins("components/brain/tree-row-menu.tsx")).toEqual([]);
		expect(nodeBuiltins("components/brain/brain-tree.tsx")).toEqual([]);
	});
});
