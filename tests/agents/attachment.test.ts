import { describe, expect, it } from "vitest";
import {
	attachmentKind,
	attachmentMeta,
	attachmentTypeLabel,
	formatAttachmentSize,
	splitFileMarkers,
} from "@/lib/agents/attachment";

describe("attachmentKind", () => {
	it("reconoce planillas por extensión o por tipo", () => {
		expect(attachmentKind("contactos.CSV", undefined)).toBe("sheet");
		expect(attachmentKind("balance.xlsx", "application/octet-stream")).toBe(
			"sheet",
		);
		expect(attachmentKind("sin-extension", "text/csv")).toBe("sheet");
	});

	it("el resto es documento", () => {
		expect(attachmentKind("mapa.pdf", "application/pdf")).toBe("document");
		expect(attachmentKind(undefined, undefined)).toBe("document");
	});
});

describe("attachmentTypeLabel", () => {
	it("usa la extensión en mayúsculas", () => {
		expect(attachmentTypeLabel("mapa.pdf")).toBe("PDF");
		expect(attachmentTypeLabel("a.b.docx")).toBe("DOCX");
	});

	it("sin extensión dice Archivo", () => {
		expect(attachmentTypeLabel("leeme")).toBe("Archivo");
		expect(attachmentTypeLabel("termina.")).toBe("Archivo");
		expect(attachmentTypeLabel(undefined)).toBe("Archivo");
	});
});

describe("formatAttachmentSize / attachmentMeta", () => {
	it("elige la unidad", () => {
		expect(formatAttachmentSize(900)).toBe("900 B");
		expect(formatAttachmentSize(12_300)).toBe("12 KB");
		expect(formatAttachmentSize(3_145_728)).toBe("3.0 MB");
	});

	it("arma la segunda línea con o sin tamaño", () => {
		expect(attachmentMeta("mapa.pdf", 204_800)).toBe("PDF · 200 KB");
		expect(attachmentMeta("mapa.pdf", undefined)).toBe("PDF");
	});
});

describe("splitFileMarkers", () => {
	it("saca la línea del adjunto y devuelve su nombre", () => {
		expect(
			splitFileMarkers("QA de un adjunto\n[file: HQ-for-work.md]"),
		).toEqual({ text: "QA de un adjunto", filenames: ["HQ-for-work.md"] });
	});

	it("sirve para solo archivo, sin nombre y varios", () => {
		expect(splitFileMarkers("[file: a.pdf]\n[file]")).toEqual({
			text: "",
			filenames: ["a.pdf", undefined],
		});
	});

	it("no toca un texto sin marcas ni una marca en medio de una frase", () => {
		expect(splitFileMarkers("hola\nver [file: x] acá")).toEqual({
			text: "hola\nver [file: x] acá",
			filenames: [],
		});
	});
});
