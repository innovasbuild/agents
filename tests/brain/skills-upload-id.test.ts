import { describe, expect, it } from "vitest";
import {
	makeUploadId,
	parseUploadId,
	UPLOAD_LINK_SECONDS,
} from "@/lib/brain/core/skills/upload-id";

const NOW = Date.parse("2026-10-20T12:00:00Z");

describe("uploadId", () => {
	it("vence a los 10 minutos", () => {
		expect(UPLOAD_LINK_SECONDS).toBe(600);
	});

	it("ida y vuelta con la carpeta raíz, una carpeta y una subcarpeta", () => {
		for (const folder of ["", "ventas", "ventas/q1"]) {
			const id = makeUploadId(folder, NOW, "a1B2-c3_d4");
			expect(id).toMatch(/^[A-Za-z0-9._~-]+$/);
			expect(parseUploadId(id, NOW)).toEqual({ folder });
		}
	});

	it("dos ids de la misma carpeta con distinto aleatorio no coinciden", () => {
		expect(makeUploadId("ventas", NOW, "uno")).not.toBe(
			makeUploadId("ventas", NOW, "dos"),
		);
	});

	it("a los 599 s sigue vigente y a los 601 s venció", () => {
		const id = makeUploadId("ventas", NOW, "r");
		expect(parseUploadId(id, NOW + 599_000)).toEqual({ folder: "ventas" });
		expect(parseUploadId(id, NOW + 601_000)).toBe("expired");
	});

	it("basura, vacío o caracteres fuera del alfabeto no son un id", () => {
		const valid = makeUploadId("ventas", NOW, "r");
		for (const id of [
			"",
			"basura",
			"a.b",
			"zz.r.Ventas",
			"zz.r.ventas..q1",
			`${valid}/x`,
			valid.replace("ventas", "ven tas"),
			valid.replace("ventas", "ventas%2F"),
			"zz.r.ventas.extra",
		]) {
			expect(parseUploadId(id, NOW)).toBeNull();
		}
	});

	it("un aleatorio fuera del alfabeto no arma un id", () => {
		expect(() => makeUploadId("ventas", NOW, "a.b")).toThrow();
		expect(() => makeUploadId("ventas", NOW, "")).toThrow();
	});
});
