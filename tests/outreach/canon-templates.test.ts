import { describe, expect, it } from "vitest";
import { parseIcpBlocks, parseMarcoBlocks } from "@/lib/outreach/canon-blocks";
import { DEFAULT_CANON_PAGES } from "@/lib/outreach/canon-templates";

// Completar la plantilla es sacarle el "# " a las líneas de ejemplo.
const completed = (body: string) =>
	body.replace(/^# (encaje|rol|excluir|h_|v_)/gm, "$1");

describe("plantillas de canon", () => {
	it("son dos, en comercial, con su tag", () => {
		expect(
			DEFAULT_CANON_PAGES.map(({ slug, category, tags }) => ({
				slug,
				category,
				tags,
			})),
		).toEqual([
			{ slug: "comercial/icp", category: "comercial", tags: ["canon:icp"] },
			{ slug: "comercial/hooks", category: "comercial", tags: ["canon:hooks"] },
		]);
	});

	it("sin completar no aportan niveles ni listas", () => {
		const [icp, hooks] = DEFAULT_CANON_PAGES;
		expect(parseIcpBlocks([icp]).icp).toBeNull();
		expect(parseMarcoBlocks([hooks])).toMatchObject({
			hooks: [],
			vectores: [],
		});
	});

	it("completadas parsean sin errores", () => {
		const [icp, hooks] = DEFAULT_CANON_PAGES;
		expect(
			parseIcpBlocks([{ ...icp, body: completed(icp.body) }]).errors,
		).toEqual([]);
		expect(
			parseMarcoBlocks([{ ...hooks, body: completed(hooks.body) }]).errors,
		).toEqual([]);
	});

	it("no nombran a ningún cliente", () => {
		for (const page of DEFAULT_CANON_PAGES) {
			expect(page.body.toLowerCase()).not.toMatch(/innov|paralelo|radar/);
		}
	});
});
