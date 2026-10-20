// Value: protects=la paleta de categorías del mapa de conexiones (--graph-1…8 en app/globals.css): ocho tonos
//   distintos en claro y en oscuro, con contraste de 3:1 o más contra --background (WCAG, elementos no textuales).
// fails_when=falta un --graph-N en :root o en .dark, deja de ser #rrggbb, dos categorías repiten color o alguna
//   queda con menos de 3:1 contra el fondo de su tema.
// why_new=el grafo (26.4b) dejó --chart-* (grises y con el rojo de --destructive) por tokens propios; seam=none

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const css = readFileSync(
	fileURLToPath(new URL("../../app/globals.css", import.meta.url)),
	"utf8",
);

function block(selector: string): string {
	const start = css.indexOf(`\n${selector} {`);
	expect(start).toBeGreaterThan(-1);
	return css.slice(start, css.indexOf("\n}", start));
}

const token = (body: string, name: string) =>
	new RegExp(`--${name}:\\s*([^;]+);`).exec(body)?.[1].trim() ?? "";

const linear = (c: number) =>
	c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;

// Luminancia relativa de #rrggbb, o de un gris oklch(L 0 0), que es L³.
function luminance(color: string): number {
	const gray = /^oklch\(\s*([\d.]+)\s+0\s+0\s*\)$/.exec(color);
	if (gray) return Number(gray[1]) ** 3;
	const hex = /^#([0-9a-f]{6})$/i.exec(color);
	if (!hex) throw new Error(`color no soportado: ${color}`);
	const n = Number.parseInt(hex[1], 16);
	const [r, g, b] = [n >> 16, (n >> 8) & 255, n & 255].map((v) =>
		linear(v / 255),
	);
	return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

const contrast = (a: string, b: string) => {
	const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
	return (hi + 0.05) / (lo + 0.05);
};

describe.each([":root", ".dark"])("--graph-1…8 en %s", (selector) => {
	const body = block(selector);
	const palette = Array.from({ length: 8 }, (_, i) =>
		token(body, `graph-${i + 1}`),
	);

	it("define ocho colores #rrggbb distintos", () => {
		for (const color of palette) expect(color).toMatch(/^#[0-9a-f]{6}$/i);
		expect(new Set(palette.map((c) => c.toLowerCase())).size).toBe(8);
	});

	it("cada uno tiene contraste de 3:1 o más contra --background", () => {
		const background = token(body, "background");
		for (const color of palette)
			expect(contrast(color, background)).toBeGreaterThanOrEqual(3);
	});
});
