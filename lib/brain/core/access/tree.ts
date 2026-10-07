// Árbol de navegación del brain (spec etapa 17 §3.5, §7.1). Puro: recibe las
// páginas que la persona puede ver y una función de permiso por ruta; no
// conoce reglas ni principales. Una carpeta es el prefijo de las páginas que
// tiene debajo (A5); una página y una carpeta con el mismo nombre comparten
// nodo (A6).
import type { BrainStatus } from "../types.ts";
import { ancestorChain } from "./resolve-access.ts";
import { atLeast, type Level, ROOT_PATH } from "./types.ts";

export interface TreePage {
	slug: string;
	title: string;
	status: BrainStatus;
}

export interface TreeNode {
	path: string; // "" para la raíz
	name: string; // último segmento de la ruta
	page: TreePage | null; // hay una página con exactamente este slug
	// Permiso sobre el nodo. null cuando la persona solo ve algo más abajo: la
	// carpeta se muestra pero no ofrece acciones propias.
	level: Level | null;
	children: TreeNode[];
}

function lastSegment(path: string): string {
	return path.slice(path.lastIndexOf("/") + 1);
}

// Primero lo que tiene hijos (las carpetas), después por nombre.
function sortNodes(nodes: TreeNode[]): void {
	nodes.sort((a, b) => {
		const folders =
			Number(b.children.length > 0) - Number(a.children.length > 0);
		return folders !== 0 ? folders : a.name.localeCompare(b.name, "es");
	});
	for (const node of nodes) sortNodes(node.children);
}

export function visibleTree(
	pages: readonly TreePage[],
	access: (path: string) => Level | null,
): TreeNode {
	const root: TreeNode = {
		path: ROOT_PATH,
		name: "",
		page: null,
		level: access(ROOT_PATH),
		children: [],
	};
	const byPath = new Map<string, TreeNode>([[ROOT_PATH, root]]);

	for (const page of pages) {
		if (access(page.slug) === null) continue;
		let parent = root;
		for (const path of ancestorChain(page.slug).slice(1)) {
			let node = byPath.get(path);
			if (!node) {
				node = {
					path,
					name: lastSegment(path),
					page: null,
					level: access(path),
					children: [],
				};
				byPath.set(path, node);
				parent.children.push(node);
			}
			parent = node;
		}
		// Solo estos tres campos viajan al navegador: nunca el cuerpo.
		parent.page = { slug: page.slug, title: page.title, status: page.status };
	}

	sortNodes(root.children);
	return root;
}

// Oculta las archivadas y las carpetas que quedan sin nada visible.
export function withoutArchived(root: TreeNode): TreeNode {
	const prune = (node: TreeNode): TreeNode | null => {
		const children = node.children
			.map(prune)
			.filter((child): child is TreeNode => child !== null);
		const page = node.page?.status === "archivado" ? null : node.page;
		if (node.path !== ROOT_PATH && page === null && children.length === 0) {
			return null;
		}
		return { ...node, page, children };
	};
	return prune(root) ?? { ...root, page: null, children: [] };
}

// Rutas donde la persona puede crear páginas: la raíz y las carpetas (nodos
// con hijos) sobre las que es editor o más.
export function editableFolders(root: TreeNode): string[] {
	const found: string[] = [];
	const walk = (node: TreeNode) => {
		const isFolder = node.path === ROOT_PATH || node.children.length > 0;
		if (isFolder && atLeast(node.level, "editor")) found.push(node.path);
		for (const child of node.children) walk(child);
	};
	walk(root);
	return found;
}
