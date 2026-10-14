// Lectura y escritura del zip de un paquete (spec etapa 24.1 §6). Vive en adapters porque
// el núcleo no toca node:zlib. Sin imports de la plataforma: se prueba solo.
//
// El directorio central se lee a mano para decidir ANTES de descomprimir nada:
// métodos admitidos, tamaños declarados, rangos de datos que no se superponen y
// topes del paquete. Cada entrada se infla con maxOutputLength igual a su
// tamaño declarado y tiene que salir exactamente de ese tamaño y con su CRC:
// un encabezado que miente se rechaza, no se trunca, y el trabajo está acotado
// por los topes aunque el zip sea una bomba.
import { crc32, deflateRawSync, inflateRawSync } from "node:zlib";
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
const INVALID = "El archivo no es un zip válido.";

const EOCD_SIG = 0x06054b50;
const CENTRAL_SIG = 0x02014b50;
const LOCAL_SIG = 0x04034b50;
const EOCD_MIN = 22;
const MAX_COMMENT = 0xffff;

// Carpetas y lo que dejan Finder y `zip -r`: no son parte del paquete, y
// planImport los rechazaría como rutas inválidas.
function isNoise(name: string): boolean {
	if (name.endsWith("/") || name.startsWith("__MACOSX/")) return true;
	const base = name.slice(name.lastIndexOf("/") + 1);
	return base === ".DS_Store" || base.startsWith("._");
}

interface Member {
	name: string;
	method: number;
	crc: number;
	size: number; // comprimido
	originalSize: number;
	start: number; // inicio de los datos
}

function findEocd(view: DataView): number {
	const lowest = Math.max(0, view.byteLength - EOCD_MIN - MAX_COMMENT);
	for (let i = view.byteLength - EOCD_MIN; i >= lowest; i--) {
		if (view.getUint32(i, true) === EOCD_SIG) return i;
	}
	throw new ZipRejected(INVALID);
}

function readMembers(zip: Uint8Array): Member[] {
	if (zip.length < EOCD_MIN) throw new ZipRejected(INVALID);
	const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
	const eocd = findEocd(view);
	const total = view.getUint16(eocd + 10, true);
	const centralOffset = view.getUint32(eocd + 16, true);
	if (total === 0xffff || centralOffset === 0xffffffff) {
		throw new ZipRejected(INVALID); // zip64: no se admite
	}
	// Barato y antes de recorrer: ni siquiera se lee un directorio enorme.
	if (total > 4 * (MAX_PACKAGE_FILES + 1)) throw new ZipRejected(TOO_BIG);

	const decoder = new TextDecoder("utf-8", { fatal: false });
	const members: Member[] = [];
	let at = centralOffset;
	for (let n = 0; n < total; n++) {
		if (at + 46 > zip.length || view.getUint32(at, true) !== CENTRAL_SIG) {
			throw new ZipRejected(INVALID);
		}
		const flags = view.getUint16(at + 8, true);
		const method = view.getUint16(at + 10, true);
		const crc = view.getUint32(at + 16, true);
		const size = view.getUint32(at + 20, true);
		const originalSize = view.getUint32(at + 24, true);
		const nameLength = view.getUint16(at + 28, true);
		const extraLength = view.getUint16(at + 30, true);
		const commentLength = view.getUint16(at + 32, true);
		const localOffset = view.getUint32(at + 42, true);
		if (at + 46 + nameLength > zip.length) throw new ZipRejected(INVALID);
		const name = decoder.decode(zip.subarray(at + 46, at + 46 + nameLength));
		at += 46 + nameLength + extraLength + commentLength;

		if (isNoise(name)) continue;
		if (flags & 1) throw new ZipRejected("El zip está cifrado.");
		if (method !== 0 && method !== 8) {
			throw new ZipRejected("El zip usa un método de compresión no admitido.");
		}
		if (
			size === 0xffffffff ||
			originalSize === 0xffffffff ||
			localOffset === 0xffffffff
		) {
			throw new ZipRejected(INVALID);
		}
		if (
			localOffset + 30 > zip.length ||
			view.getUint32(localOffset, true) !== LOCAL_SIG
		) {
			throw new ZipRejected(INVALID);
		}
		const start =
			localOffset +
			30 +
			view.getUint16(localOffset + 26, true) +
			view.getUint16(localOffset + 28, true);
		if (start + size > zip.length) throw new ZipRejected(INVALID);
		members.push({ name, method, crc, size, originalSize, start });
	}
	return members;
}

function checkDeclared(members: Member[], zipLength: number): void {
	if (members.length > MAX_PACKAGE_FILES + 1) throw new ZipRejected(TOO_BIG);
	const names = new Set<string>();
	let declared = 0;
	let compressed = 0;
	for (const member of members) {
		if (names.has(member.name)) {
			throw new ZipRejected(`Nombre repetido en el zip: ${member.name}`);
		}
		names.add(member.name);
		if (member.originalSize > MAX_FILE_BYTES) throw new ZipRejected(TOO_BIG);
		if (member.method === 0 && member.size !== member.originalSize) {
			throw new ZipRejected(INVALID);
		}
		declared += member.originalSize;
		compressed += member.size;
	}
	// +1 tamaño máximo: SKILL.md no cuenta para el tope del paquete; el límite
	// exacto lo juzga planImport.
	if (declared > MAX_PACKAGE_BYTES + MAX_FILE_BYTES) {
		throw new ZipRejected(TOO_BIG);
	}
	// Lo comprimido no puede sumar más que el zip: así dos entradas no comparten
	// los mismos bytes para multiplicar el trabajo.
	if (compressed > zipLength) throw new ZipRejected(INVALID);
	const sorted = [...members].sort((a, b) => a.start - b.start);
	for (let i = 1; i < sorted.length; i++) {
		if (sorted[i].start < sorted[i - 1].start + sorted[i - 1].size) {
			throw new ZipRejected(INVALID);
		}
	}
}

function extract(zip: Uint8Array, member: Member): Uint8Array {
	const data = zip.subarray(member.start, member.start + member.size);
	let out: Uint8Array;
	if (member.method === 0) {
		out = data;
	} else {
		try {
			// maxOutputLength >= 1; una entrada vacía se valida abajo por tamaño.
			out = inflateRawSync(data, {
				maxOutputLength: Math.max(member.originalSize, 1),
			});
		} catch {
			throw new ZipRejected(INVALID);
		}
	}
	if (out.length !== member.originalSize || crc32(out) !== member.crc) {
		throw new ZipRejected(INVALID);
	}
	return new Uint8Array(out);
}

export function unzipPackage(zip: Uint8Array): PackageEntry[] {
	const members = readMembers(zip);
	checkDeclared(members, zip.length);
	return members.map((member) => ({
		path: member.name,
		bytes: extract(zip, member),
	}));
}

const UTF8_NAMES = 0x0800;
const DOS_DATE = 0x0021; // 1980-01-01: sin fecha real, el zip es reproducible.

// Espejo de unzipPackage (spec etapa 24.2a §5): métodos 0 y 8, sin zip64. Los
// topes del paquete (20 MB, 50 archivos) quedan muy por debajo de sus límites.
export function zipPackage(entries: PackageEntry[]): Uint8Array {
	const encoder = new TextEncoder();
	const parts: Uint8Array[] = [];
	const central: Uint8Array[] = [];
	let offset = 0;

	for (const entry of entries) {
		const name = encoder.encode(entry.path);
		const deflated = deflateRawSync(entry.bytes);
		const stored = deflated.length >= entry.bytes.length;
		const data = stored ? entry.bytes : deflated;
		const method = stored ? 0 : 8;
		const crc = crc32(entry.bytes);

		const local = new Uint8Array(30 + name.length);
		const lv = new DataView(local.buffer);
		lv.setUint32(0, LOCAL_SIG, true);
		lv.setUint16(4, 20, true);
		lv.setUint16(6, UTF8_NAMES, true);
		lv.setUint16(8, method, true);
		lv.setUint16(12, DOS_DATE, true);
		lv.setUint32(14, crc, true);
		lv.setUint32(18, data.length, true);
		lv.setUint32(22, entry.bytes.length, true);
		lv.setUint16(26, name.length, true);
		local.set(name, 30);

		const header = new Uint8Array(46 + name.length);
		const cv = new DataView(header.buffer);
		cv.setUint32(0, CENTRAL_SIG, true);
		cv.setUint16(4, 20, true);
		cv.setUint16(6, 20, true);
		cv.setUint16(8, UTF8_NAMES, true);
		cv.setUint16(10, method, true);
		cv.setUint16(14, DOS_DATE, true);
		cv.setUint32(16, crc, true);
		cv.setUint32(20, data.length, true);
		cv.setUint32(24, entry.bytes.length, true);
		cv.setUint16(28, name.length, true);
		cv.setUint32(42, offset, true);
		header.set(name, 46);

		parts.push(local, data);
		central.push(header);
		offset += local.length + data.length;
	}

	const centralSize = central.reduce((total, part) => total + part.length, 0);
	const end = new Uint8Array(EOCD_MIN);
	const ev = new DataView(end.buffer);
	ev.setUint32(0, EOCD_SIG, true);
	ev.setUint16(8, entries.length, true);
	ev.setUint16(10, entries.length, true);
	ev.setUint32(12, centralSize, true);
	ev.setUint32(16, offset, true);

	const out = new Uint8Array(offset + centralSize + EOCD_MIN);
	let at = 0;
	for (const part of [...parts, ...central, end]) {
		out.set(part, at);
		at += part.length;
	}
	return out;
}
