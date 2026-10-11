// Lectura del zip de un paquete (spec etapa 24.1 §6). Vive en adapters porque
// core no puede importar fflate. Sin otros imports de la plataforma: se prueba
// solo. Los topes se miran en el tamaño que declara cada entrada, antes de
// descomprimirla, y otra vez sobre lo que salió. fflate descomprime cada
// entrada en un buffer del tamaño declarado, así que un encabezado que miente
// no hace crecer la memoria más allá de ese tope.
import { unzipSync } from "fflate";
import type { PackageEntry } from "../core/skills/files";
import {
	MAX_FILE_BYTES,
	MAX_PACKAGE_BYTES,
	MAX_PACKAGE_FILES,
} from "../core/skills/package";

export class ZipRejected extends Error {
	constructor(message: string) {
		super(message);
		this.name = "ZipRejected";
	}
}

const TOO_BIG =
	"El paquete supera los límites: 50 archivos, 4 MB por archivo y 20 MB en total.";

// Carpetas y lo que dejan Finder y `zip -r`: no son parte del paquete, y
// planImport los rechazaría como rutas inválidas.
function isNoise(name: string): boolean {
	if (name.endsWith("/") || name.startsWith("__MACOSX/")) return true;
	const base = name.slice(name.lastIndexOf("/") + 1);
	return base === ".DS_Store" || base.startsWith("._");
}

export function unzipPackage(zip: Uint8Array): PackageEntry[] {
	let count = 0;
	let declared = 0;
	const seen = new Set<string>();
	let files: Record<string, Uint8Array>;
	try {
		files = unzipSync(zip, {
			filter(file) {
				if (isNoise(file.name)) return false;
				if (seen.has(file.name)) {
					throw new ZipRejected(`Nombre repetido en el zip: ${file.name}`);
				}
				seen.add(file.name);
				count += 1;
				declared += file.originalSize;
				// +1 archivo y +1 tamaño máximo: SKILL.md no cuenta para el tope del
				// paquete. El límite exacto lo juzga planImport.
				if (
					count > MAX_PACKAGE_FILES + 1 ||
					file.originalSize > MAX_FILE_BYTES ||
					declared > MAX_PACKAGE_BYTES + MAX_FILE_BYTES
				) {
					throw new ZipRejected(TOO_BIG);
				}
				return true;
			},
		});
	} catch (error) {
		if (error instanceof ZipRejected) throw error;
		throw new ZipRejected("El archivo no es un zip válido.");
	}

	const entries = Object.entries(files).map(([path, bytes]) => ({
		path,
		bytes,
	}));
	// Un encabezado puede mentir sobre el tamaño: se vuelve a mirar lo que salió.
	let total = 0;
	for (const entry of entries) {
		total += entry.bytes.length;
		if (entry.bytes.length > MAX_FILE_BYTES) throw new ZipRejected(TOO_BIG);
	}
	if (total > MAX_PACKAGE_BYTES + MAX_FILE_BYTES)
		throw new ZipRejected(TOO_BIG);
	return entries;
}
