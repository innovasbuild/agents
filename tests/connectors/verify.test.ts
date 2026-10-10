import { describe, expect, it, vi } from "vitest";
import { checkConnectors, verifiedNameFor } from "@/lib/connectors/verify";

const describeOk = async (uid: string) => ({ name: `Nombre ${uid}`, service: "coldiq" });

describe("checkConnectors", () => {
	it("en Vercel, confirma cada identificador y devuelve sus nombres", async () => {
		expect(
			await checkConnectors(["a", "b"], { inVercel: true, describe: describeOk }),
		).toEqual({ ok: true, names: { a: "Nombre a", b: "Nombre b" } });
	});

	it("en Vercel, un identificador que no existe corta y lo nombra", async () => {
		const describe = async (uid: string) => (uid === "b" ? null : { name: "A", service: "s" });

		expect(await checkConnectors(["a", "b"], { inVercel: true, describe })).toEqual({
			ok: false,
			message: "El conector `b` no existe o no está adjunto a este proyecto en Vercel.",
		});
	});

	it("en Vercel, un error al consultar corta con el mensaje genérico y lo loguea", async () => {
		const error = vi.spyOn(console, "error").mockImplementation(() => {});
		const describe = async () => {
			throw new Error("red caída");
		};

		expect(await checkConnectors(["a"], { inVercel: true, describe })).toEqual({
			ok: false,
			message: "No pude verificar el conector en Vercel. Probá de nuevo.",
		});
		expect(error).toHaveBeenCalled();
		error.mockRestore();
	});

	it("fuera de Vercel no consulta y no hay nombres", async () => {
		const describe = vi.fn(describeOk);

		expect(await checkConnectors(["a"], { inVercel: false, describe })).toEqual({
			ok: true,
			names: {},
		});
		expect(describe).not.toHaveBeenCalled();
	});

	it("sin identificadores no consulta", async () => {
		const describe = vi.fn(describeOk);
		expect(await checkConnectors([], { inVercel: true, describe })).toEqual({
			ok: true,
			names: {},
		});
		expect(describe).not.toHaveBeenCalled();
	});
});

describe("verifiedNameFor", () => {
	it("une los nombres en el orden de los identificadores", () => {
		expect(verifiedNameFor(["b", "a"], { a: "A", b: "B" })).toBe("B, A");
	});

	it("si falta alguno, o no hay identificadores, es null", () => {
		expect(verifiedNameFor(["a", "b"], { a: "A" })).toBeNull();
		expect(verifiedNameFor([], {})).toBeNull();
	});
});
