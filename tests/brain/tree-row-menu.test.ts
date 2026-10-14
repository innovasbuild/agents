import { describe, expect, it } from "vitest";
import { folderMenuItems } from "@/components/brain/tree-row-menu";
import type { TreeNode } from "@/lib/brain/core/access/tree";

const node = (over: Partial<TreeNode>): TreeNode => ({
	path: "comercial",
	name: "comercial",
	page: null,
	folder: { description: "" },
	level: "administrador",
	children: [],
	...over,
});

describe("folderMenuItems", () => {
	it("un administrador de la raíz ve las acciones de carpeta", () => {
		expect(folderMenuItems(node({}), "administrador")).toEqual([
			"new-subfolder",
			"describe",
			"delete-folder",
		]);
	});
	it("un editor no ve ninguna", () => {
		expect(folderMenuItems(node({ level: "editor" }), "administrador")).toEqual(
			[],
		);
	});
	// Antes ofrecía "Nueva subcarpeta" acá: brain_create_folder pide la fila del
	// padre y respondía siempre no encontrado.
	it("una carpeta implícita (sin fila) no ofrece nada", () => {
		expect(
			folderMenuItems(
				node({ folder: null, children: [node({ path: "comercial/x" })] }),
				"administrador",
			),
		).toEqual([]);
	});
	it("la raíz ofrece nueva carpeta", () => {
		expect(
			folderMenuItems(
				node({ path: "", name: "", folder: null }),
				"administrador",
			),
		).toEqual(["new-subfolder"]);
	});
	it("una de primer nivel no se borra si no administra la raíz", () => {
		expect(folderMenuItems(node({}), "editor")).toEqual([
			"new-subfolder",
			"describe",
		]);
	});
	it("una subcarpeta se borra administrando solo esa carpeta", () => {
		expect(
			folderMenuItems(
				node({ path: "comercial/sucursales", name: "sucursales" }),
				"lector",
			),
		).toEqual(["new-subfolder", "describe", "delete-folder"]);
	});
});
