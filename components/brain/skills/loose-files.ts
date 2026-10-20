import {
	isValidFilePath,
	MAX_FILE_BYTES,
} from "@/lib/brain/core/skills/package";

// Archivos sueltos que se arrastran o se eligen en el panel de una skill (spec
// 24.6 D10). No es una importación: cada archivo es un pedido aparte, sin vista
// previa y sin todo-o-nada.

export interface LooseEntry {
	file: File;
	path: string;
}

export interface LooseFailure {
	path: string;
	reason: string;
}

export interface LooseResult {
	sent: number;
	total: number;
	failures: LooseFailure[];
	notices: string[];
}

export type PostLoose = (
	file: File,
	path: string,
) => Promise<{ ok: boolean; message?: string }>;

// Con webkitRelativePath ("carpeta/scripts/a.py") se quita el primer tramo: la
// carpeta elegida o arrastrada no es parte del paquete.
export function looseFilePath(file: {
	name: string;
	webkitRelativePath?: string;
}): string {
	const relative = file.webkitRelativePath;
	if (!relative) return file.name;
	const inside = relative.split("/").slice(1).join("/");
	return inside || file.name;
}

// Lee de a lotes hasta que devuelve vacío: una sola llamada trae ~100 como mucho.
async function readAll(
	reader: FileSystemDirectoryReader,
): Promise<FileSystemEntry[]> {
	const all: FileSystemEntry[] = [];
	for (;;) {
		const batch = await new Promise<FileSystemEntry[]>((resolve, reject) =>
			reader.readEntries(resolve, reject),
		);
		if (batch.length === 0) return all;
		all.push(...batch);
	}
}

async function walk(
	entry: FileSystemEntry,
	prefix: string,
	out: LooseEntry[],
): Promise<void> {
	if (entry.isFile) {
		const file = await new Promise<File>((resolve, reject) =>
			(entry as FileSystemFileEntry).file(resolve, reject),
		);
		out.push({ file, path: `${prefix}${entry.name}` });
		return;
	}
	if (!entry.isDirectory) return;
	const children = await readAll(
		(entry as FileSystemDirectoryEntry).createReader(),
	);
	for (const child of children) {
		await walk(child, `${prefix}${entry.name}/`, out);
	}
}

// Las rutas salen sin la carpeta raíz arrastrada. Las entradas se piden todas
// antes del primer await: el navegador vacía la lista al volver al event loop.
export async function collectDropped(
	items: DataTransferItemList,
): Promise<LooseEntry[]> {
	const roots: { entry: FileSystemEntry | null; file: File | null }[] = [];
	for (const item of Array.from(items)) {
		if (item.kind !== "file") continue;
		roots.push({ entry: item.webkitGetAsEntry(), file: item.getAsFile() });
	}
	const out: LooseEntry[] = [];
	for (const { entry, file } of roots) {
		if (!entry) {
			if (file) out.push({ file, path: file.name });
		} else if (entry.isDirectory) {
			const children = await readAll(
				(entry as FileSystemDirectoryEntry).createReader(),
			);
			for (const child of children) await walk(child, "", out);
		} else {
			await walk(entry, "", out);
		}
	}
	return out;
}

const isHidden = (path: string) =>
	path.split("/").some((part) => part.startsWith("."));

// Sube de a uno, en orden. Un archivo que falla no frena al resto; se cuenta lo
// que entró contra lo que se intentó.
export async function uploadLoose(
	entries: LooseEntry[],
	post: PostLoose,
): Promise<LooseResult> {
	const failures: LooseFailure[] = [];
	const notices: string[] = [];
	let sent = 0;
	let total = 0;
	let hidden = 0;

	for (const { file, path } of entries) {
		if (path.toLowerCase() === "skill.md") {
			const notice = "SKILL.md se cambia desde el editor o con un zip.";
			if (!notices.includes(notice)) notices.push(notice);
			continue;
		}
		if (isHidden(path)) {
			hidden += 1;
			continue;
		}
		total += 1;
		if (!isValidFilePath(path)) {
			failures.push({
				path,
				reason:
					"La ruta no es válida: letras, números, punto, guion y guion bajo, sin espacios y hasta 6 niveles.",
			});
			continue;
		}
		if (file.size > MAX_FILE_BYTES) {
			failures.push({ path, reason: "El archivo supera los 4 MB." });
			continue;
		}
		try {
			const result = await post(file, path);
			if (result.ok) sent += 1;
			else
				failures.push({
					path,
					reason: result.message ?? "No se pudo subir.",
				});
		} catch {
			failures.push({ path, reason: "No se pudo subir. Probá de nuevo." });
		}
	}

	if (hidden > 0) {
		notices.push(
			hidden === 1
				? "Se omitió 1 archivo oculto."
				: `Se omitieron ${hidden} archivos ocultos.`,
		);
	}
	return { sent, total, failures, notices };
}
