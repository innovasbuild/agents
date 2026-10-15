// Árbol de navegación del brain (spec etapa 17 §3.5, §7.1). Puro: recibe las
// páginas que la persona puede ver y una función de permiso por ruta; no
// conoce reglas ni principales. Una carpeta es el prefijo de las páginas que
// tiene debajo (A5); una página y una carpeta con el mismo nombre comparten
// nodo (A6).
import type { BrainFolder } from "../folders.ts";
import {
	folderOfPage,
	isReservedSlug,
	isRulesSlug,
} from "../reserved-slugs.ts";
import type { BrainStatus } from "../types.ts";
import { ancestorChain } from "./resolve-access.ts";
import { atLeast, type Level, ROOT_PATH } from "./types.ts";

export interface TreePage {
	slug: string;
	title: string;
	status: BrainStatus;
	// Skill sin publicar o con cambios sin publicar. Solo se marca para quien
	// puede editarla.
	pending?: boolean;
}

export interface TreeNode {
	path: string; // "" para la raíz
	name: string; // último segmento de la ruta
	page: TreePage | null; // hay una página con exactamente este slug
	// Carpeta guardada en brain_folders (puede estar vacía). null si el nodo
	// solo existe por las páginas que cuelgan de él.
	folder: { description: string } | null;
	// 00-reglas y 00-plantilla de esta carpeta (spec etapa 26 §4.1): no se
	// listan como hijas; el menú las abre. Sin cuerpo, como page. En la raíz,
	// rules son las instrucciones del brain.
	rules: TreePage | null;
	template: TreePage | null;
	// Permiso sobre el nodo. null cuando la persona solo ve algo más abajo: la
	// carpeta se muestra pero no ofrece acciones propias.
	level: Level | null;
	children: TreeNode[];
}

function lastSegment(path: string): string {
	return path.slice(path.lastIndexOf("/") + 1);
}

export function isFolderNode(node: TreeNode): boolean {
	return (
		node.path === ROOT_PATH ||
		node.folder !== null ||
		node.rules !== null ||
		node.template !== null ||
		node.children.length > 0
	);
}

// Primero las carpetas, después por nombre.
function sortNodes(nodes: TreeNode[]): void {
	nodes.sort((a, b) => {
		const folders = Number(isFolderNode(b)) - Number(isFolderNode(a));
		return folders !== 0 ? folders : a.name.localeCompare(b.name, "es");
	});
	for (const node of nodes) sortNodes(node.children);
}

export function visibleTree(
	pages: readonly TreePage[],
	access: (path: string) => Level | null,
	folders: readonly BrainFolder[] = [],
): TreeNode {
	const root: TreeNode = {
		path: ROOT_PATH,
		name: "",
		page: null,
		folder: null,
		rules: null,
		template: null,
		level: access(ROOT_PATH),
		children: [],
	};
	const byPath = new Map<string, TreeNode>([[ROOT_PATH, root]]);

	const ensure = (path: string): TreeNode => {
		let parent = root;
		for (const step of ancestorChain(path).slice(1)) {
			let node = byPath.get(step);
			if (!node) {
				node = {
					path: step,
					name: lastSegment(step),
					page: null,
					folder: null,
					rules: null,
					template: null,
					level: access(step),
					children: [],
				};
				byPath.set(step, node);
				parent.children.push(node);
			}
			parent = node;
		}
		return parent;
	};

	for (const folder of [...folders].sort((a, b) =>
		a.path.localeCompare(b.path),
	)) {
		if (access(folder.path) === null) continue;
		ensure(folder.path).folder = { description: folder.description };
	}

	for (const page of pages) {
		if (access(page.slug) === null) continue;
		// Solo estos campos viajan al navegador: nunca el cuerpo.
		const shown: TreePage = {
			slug: page.slug,
			title: page.title,
			status: page.status,
			...(page.pending ? { pending: true } : {}),
		};
		if (isReservedSlug(page.slug)) {
			const folder = ensure(folderOfPage(page.slug));
			if (isRulesSlug(page.slug)) folder.rules = shown;
			else folder.template = shown;
			continue;
		}
		ensure(page.slug).page = shown;
	}

	sortNodes(root.children);
	return root;
}

// Oculta las archivadas y las carpetas que quedan sin nada visible. Las marcas
// de reservadas se conservan aunque estén archivadas (el menú las abre en vez
// de ofrecer crear otra); una carpeta sin otra cosa que una archivada se poda.
export function withoutArchived(root: TreeNode): TreeNode {
	const live = (reserved: TreePage | null) =>
		reserved !== null && reserved.status !== "archivado";
	const prune = (node: TreeNode): TreeNode | null => {
		const children = node.children
			.map(prune)
			.filter((child): child is TreeNode => child !== null);
		const page = node.page?.status === "archivado" ? null : node.page;
		if (
			node.path !== ROOT_PATH &&
			page === null &&
			children.length === 0 &&
			node.folder === null &&
			!live(node.rules) &&
			!live(node.template)
		) {
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
		const isFolder = isFolderNode(node);
		if (isFolder && atLeast(node.level, "editor")) found.push(node.path);
		for (const child of node.children) walk(child);
	};
	walk(root);
	return found;
}

// Páginas comunes del nodo y de lo que cuelga: las reservadas no son páginas
// del listado (una carpeta con solo su 00-reglas está "Vacía").
export function countPages(node: TreeNode): number {
	return (
		(node.page ? 1 : 0) +
		node.children.reduce((sum, child) => sum + countPages(child), 0)
	);
}

export const FOLDER_HAS_CONTENT =
	"Tiene páginas o subcarpetas (también archivadas): vaciala antes de borrarla.";
export const FOLDER_HAS_RULES =
	"Tiene reglas propias: borralas desde «Reglas de la carpeta» antes de borrarla.";

// Por qué no se puede borrar cada carpeta (spec etapa 26 §3.2), sobre el árbol
// SIN podar: brain_delete_folder cuenta toda página bajo el prefijo, archivadas
// y reservadas incluidas. Solo es experiencia: lo oculto lo frena la base.
export function folderDeleteBlocks(root: TreeNode): Map<string, string> {
	const blocks = new Map<string, string>();
	const walk = (node: TreeNode) => {
		if (node.path !== ROOT_PATH) {
			if (node.page !== null || node.children.length > 0)
				blocks.set(node.path, FOLDER_HAS_CONTENT);
			else if (node.rules !== null || node.template !== null)
				blocks.set(node.path, FOLDER_HAS_RULES);
		}
		for (const child of node.children) walk(child);
	};
	walk(root);
	return blocks;
}
