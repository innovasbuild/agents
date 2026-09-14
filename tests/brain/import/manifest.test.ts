import { describe, expect, it } from "vitest";
import {
	isIncluded,
	parseManifest,
	tagsFor,
} from "@/lib/brain/import/manifest";

const manifest = parseManifest({
	include: ["comercial/**/*.md", "marketing/**/*.md"],
	exclude: ["comercial/outreach/runs/**", "**/README.md"],
	tags: [
		{ match: "marketing/mensajes-*.md", tags: ["canon:mensajes"] },
		{ match: "comercial/outreach/voz/**", tags: ["canon:voz"] },
	],
});

describe("manifiesto del import", () => {
	it("incluye por glob y excluye con prioridad", () => {
		expect(isIncluded(manifest, "comercial/cuenta-aluex.md")).toBe(true);
		expect(isIncluded(manifest, "comercial/outreach/runs/2026-09-11.md")).toBe(
			false,
		);
		expect(isIncluded(manifest, "comercial/outreach/voz/README.md")).toBe(
			false,
		);
		expect(isIncluded(manifest, "AGENT.md")).toBe(false);
	});

	it("junta los tags de todas las reglas que matchean", () => {
		expect(tagsFor(manifest, "marketing/mensajes-innovas.md")).toEqual([
			"canon:mensajes",
		]);
		expect(tagsFor(manifest, "comercial/outreach/voz/mati.md")).toEqual([
			"canon:voz",
		]);
		expect(tagsFor(manifest, "comercial/cuenta-aluex.md")).toEqual([]);
	});

	it("rechaza un manifiesto mal formado", () => {
		expect(() => parseManifest({ include: "comercial/**" })).toThrow(/include/);
		expect(() =>
			parseManifest({ include: ["a/**"], tags: [{ match: "a/**" }] }),
		).toThrow(/tags/);
	});
});
