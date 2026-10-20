import { describe, expect, it, vi } from "vitest";
import {
	collectDropped,
	looseFilePath,
	uploadLoose,
} from "@/components/brain/skills/loose-files";

const file = (name: string, size = 3) => new File([new Uint8Array(size)], name);

describe("looseFilePath", () => {
	it("quita la carpeta arrastrada", () => {
		expect(
			looseFilePath({
				name: "a.py",
				webkitRelativePath: "mi-skill/scripts/a.py",
			}),
		).toBe("scripts/a.py");
	});

	it("sin ruta relativa usa el nombre", () => {
		expect(looseFilePath({ name: "a.py" })).toBe("a.py");
		expect(looseFilePath({ name: "a.py", webkitRelativePath: "" })).toBe(
			"a.py",
		);
	});
});

describe("uploadLoose", () => {
	const ok = () => Promise.resolve({ ok: true });

	it("sube de a uno, en orden, y cuenta lo que entró", async () => {
		const order: string[] = [];
		let running = 0;
		let overlapped = false;
		const post = vi.fn(async (_f: File, path: string) => {
			running += 1;
			if (running > 1) overlapped = true;
			await Promise.resolve();
			order.push(path);
			running -= 1;
			return { ok: true };
		});
		const result = await uploadLoose(
			[
				{ file: file("a.py"), path: "scripts/a.py" },
				{ file: file("b.md"), path: "b.md" },
				{ file: file("c.csv"), path: "assets/c.csv" },
			],
			post,
		);
		expect(order).toEqual(["scripts/a.py", "b.md", "assets/c.csv"]);
		expect(overlapped).toBe(false);
		expect(result).toMatchObject({ sent: 3, total: 3, failures: [] });
	});

	it("un fallo no frena al resto y se informa con su ruta y motivo", async () => {
		const post = vi.fn(async (_f: File, path: string) =>
			path === "b.md"
				? { ok: false, message: "Ya hay 50 archivos." }
				: { ok: true },
		);
		const result = await uploadLoose(
			[
				{ file: file("a.py"), path: "a.py" },
				{ file: file("b.md"), path: "b.md" },
				{ file: file("c.py"), path: "c.py" },
			],
			post,
		);
		expect(post).toHaveBeenCalledTimes(3);
		expect(result.sent).toBe(2);
		expect(result.total).toBe(3);
		expect(result.failures).toEqual([
			{ path: "b.md", reason: "Ya hay 50 archivos." },
		]);
	});

	it("un pedido que revienta es un fallo de ese archivo", async () => {
		const post = vi
			.fn()
			.mockRejectedValueOnce(new Error("red"))
			.mockResolvedValueOnce({ ok: true });
		const result = await uploadLoose(
			[
				{ file: file("a.py"), path: "a.py" },
				{ file: file("b.py"), path: "b.py" },
			],
			post,
		);
		expect(result.sent).toBe(1);
		expect(result.failures).toEqual([
			{ path: "a.py", reason: "No se pudo subir. Probá de nuevo." },
		]);
	});

	it("omite SKILL.md con el aviso y no lo cuenta", async () => {
		const post = vi.fn(ok);
		const result = await uploadLoose(
			[
				{ file: file("SKILL.md"), path: "SKILL.md" },
				{ file: file("skill.md"), path: "skill.md" },
				{ file: file("a.py"), path: "a.py" },
			],
			post,
		);
		expect(post).toHaveBeenCalledTimes(1);
		expect(result).toMatchObject({ sent: 1, total: 1, failures: [] });
		expect(result.notices).toEqual([
			"SKILL.md se cambia desde el editor o con un zip.",
		]);
	});

	it("rutas inválidas y archivos de más de 4 MB fallan sin pedido", async () => {
		const post = vi.fn(ok);
		const result = await uploadLoose(
			[
				{ file: file("con espacio.txt"), path: "con espacio.txt" },
				{ file: file("big.bin", 4_194_305), path: "big.bin" },
			],
			post,
		);
		expect(post).not.toHaveBeenCalled();
		expect(result.sent).toBe(0);
		expect(result.total).toBe(2);
		expect(result.failures.map((f) => f.path)).toEqual([
			"con espacio.txt",
			"big.bin",
		]);
		expect(result.failures[1]?.reason).toBe("El archivo supera los 4 MB.");
	});

	it("los archivos ocultos se omiten con aviso y no cuentan", async () => {
		const post = vi.fn(ok);
		const result = await uploadLoose(
			[
				{ file: file(".DS_Store"), path: ".DS_Store" },
				{ file: file("x"), path: "scripts/.cache/x" },
				{ file: file("a.py"), path: "a.py" },
			],
			post,
		);
		expect(post).toHaveBeenCalledTimes(1);
		expect(result).toMatchObject({ sent: 1, total: 1, failures: [] });
		expect(result.notices).toEqual(["Se omitieron 2 archivos ocultos."]);
	});
});

// Entradas falsas del sistema de archivos del navegador.
function fileEntry(name: string) {
	return {
		isFile: true,
		isDirectory: false,
		name,
		file: (resolve: (f: File) => void) => resolve(file(name)),
	};
}

function dirEntry(name: string, children: unknown[], batchSize = 2) {
	return {
		isFile: false,
		isDirectory: true,
		name,
		createReader() {
			let offset = 0;
			return {
				readEntries(resolve: (e: unknown[]) => void) {
					const batch = children.slice(offset, offset + batchSize);
					offset += batchSize;
					resolve(batch);
				},
			};
		},
	};
}

const itemsOf = (...entries: (unknown | null)[]) =>
	entries.map((entry) => ({
		kind: "file",
		webkitGetAsEntry: () => entry,
		getAsFile: () => (entry ? null : file("plano.txt")),
	})) as unknown as DataTransferItemList;

describe("collectDropped", () => {
	it("recorre la carpeta en lotes y quita la carpeta raíz de las rutas", async () => {
		const root = dirEntry("mi-skill", [
			fileEntry("a.md"),
			dirEntry("scripts", [
				fileEntry("x.py"),
				fileEntry("y.py"),
				fileEntry("z.py"),
			]),
			fileEntry("b.md"),
		]);
		const found = await collectDropped(itemsOf(root));
		expect(found.map((e) => e.path).sort()).toEqual([
			"a.md",
			"b.md",
			"scripts/x.py",
			"scripts/y.py",
			"scripts/z.py",
		]);
	});

	it("un archivo suelto conserva su nombre y mezcla con carpetas", async () => {
		const found = await collectDropped(
			itemsOf(fileEntry("solo.txt"), dirEntry("d", [fileEntry("in.txt")])),
		);
		expect(found.map((e) => e.path)).toEqual(["solo.txt", "in.txt"]);
	});

	it("sin webkitGetAsEntry usa el archivo del item", async () => {
		const found = await collectDropped(itemsOf(null));
		expect(found.map((e) => e.path)).toEqual(["plano.txt"]);
	});
});
