import { zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { unzipPackage, ZipRejected } from "@/lib/brain/adapters/skill-zip";
import { MAX_FILE_BYTES } from "@/lib/brain/core/skills/package";

const bytes = (text: string) => new TextEncoder().encode(text);

// Pisa el tamaño sin comprimir que declara el directorio central (offset 24
// de cada entrada), para simular un encabezado que miente.
function lieAboutSize(zip: Uint8Array, size: number): Uint8Array {
	const copy = zip.slice();
	const view = new DataView(copy.buffer);
	for (let i = 0; i < copy.length - 4; i++) {
		if (view.getUint32(i, true) === 0x02014b50)
			view.setUint32(i + 24, size, true);
	}
	return copy;
}

describe("unzipPackage", () => {
	it("devuelve los archivos y descarta carpetas y basura de macOS", () => {
		const zip = zipSync({
			"facturacion/SKILL.md": bytes("---\ndescription: x\n---\ncuerpo"),
			"facturacion/scripts/calc.py": bytes("print(1)"),
			"facturacion/scripts/": new Uint8Array(0),
			"facturacion/scripts/._calc.py": bytes("x"),
			"__MACOSX/facturacion/._SKILL.md": bytes("x"),
			"facturacion/.DS_Store": bytes("x"),
			".DS_Store": bytes("x"),
		});
		expect(
			unzipPackage(zip)
				.map((entry) => entry.path)
				.sort(),
		).toEqual(["facturacion/SKILL.md", "facturacion/scripts/calc.py"]);
	});

	it("no cuenta la basura contra los topes", () => {
		const files = Object.fromEntries(
			Array.from({ length: 60 }, (_, i) => [`__MACOSX/._f${i}`, bytes("x")]),
		);
		files["SKILL.md"] = bytes("x");
		expect(unzipPackage(zipSync(files))).toHaveLength(1);
	});

	it("rechaza por tamaño declarado antes de descomprimir", () => {
		// Ceros: comprime a pocos KB y se infla a más del tope por archivo.
		const zip = zipSync({ "grande.bin": new Uint8Array(MAX_FILE_BYTES + 1) });
		expect(zip.length).toBeLessThan(100_000);
		expect(() => unzipPackage(zip)).toThrow(ZipRejected);
	});

	it("rechaza un total declarado mayor al del paquete", () => {
		const half = new Uint8Array(MAX_FILE_BYTES);
		const zip = zipSync(
			Object.fromEntries(
				Array.from({ length: 7 }, (_, i) => [`f${i}.bin`, half]),
			),
		);
		expect(zip.length).toBeLessThan(200_000);
		expect(() => unzipPackage(zip)).toThrow(ZipRejected);
	});

	it("un encabezado que miente no hace crecer la memoria más de lo declarado", () => {
		const zip = lieAboutSize(
			zipSync({ "a.bin": new Uint8Array(MAX_FILE_BYTES) }),
			100,
		);
		let out: ReturnType<typeof unzipPackage> | null = null;
		try {
			out = unzipPackage(zip);
		} catch (error) {
			expect(error).toBeInstanceOf(ZipRejected);
		}
		if (out) expect(out.every((entry) => entry.bytes.length <= 100)).toBe(true);
	});

	it("rechaza un paquete con más archivos de los que admite", () => {
		const many = Object.fromEntries(
			Array.from({ length: 60 }, (_, i) => [`f${i}.txt`, bytes("x")]),
		);
		expect(() => unzipPackage(zipSync(many))).toThrow(ZipRejected);
	});

	it("deja pasar nombres raros para que los juzgue planImport", () => {
		const zip = zipSync({
			"a/../b.txt": bytes("x"),
			"/abs.txt": bytes("x"),
		});
		expect(
			unzipPackage(zip)
				.map((entry) => entry.path)
				.sort(),
		).toEqual(["/abs.txt", "a/../b.txt"]);
	});

	it("rechaza dos entradas con el mismo nombre", () => {
		const zip = zipSync({ "aa.txt": bytes("1"), "ab.txt": bytes("2") });
		const forged = zip.slice();
		const target = bytes("ab.txt");
		const source = bytes("aa.txt");
		for (let i = 0; i < forged.length - target.length; i++) {
			if (target.every((byte, j) => forged[i + j] === byte))
				forged.set(source, i);
		}
		expect(() => unzipPackage(forged)).toThrow(ZipRejected);
	});

	it("rechaza lo que no es un zip", () => {
		expect(() => unzipPackage(bytes("no soy un zip"))).toThrow(ZipRejected);
	});
});
