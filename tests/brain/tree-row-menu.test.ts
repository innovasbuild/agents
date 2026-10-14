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
	it("un administrador ve las acciones de carpeta", () => {
		expect(folderMenuItems(node({}))).toEqual([
			"new-subfolder",
			"describe",
			"delete-folder",
		]);
	});
	it("un editor no ve ninguna", () => {
		expect(folderMenuItems(node({ level: "editor" }))).toEqual([]);
	});
	it("una carpeta implícita (sin fila) no se describe ni se borra", () => {
		expect(
			folderMenuItems(
				node({ folder: null, children: [node({ path: "comercial/x" })] }),
			),
		).toEqual(["new-subfolder"]);
	});
	it("la raíz ofrece nueva carpeta", () => {
		expect(folderMenuItems(node({ path: "", name: "", folder: null }))).toEqual(
			["new-subfolder"],
		);
	});
});
