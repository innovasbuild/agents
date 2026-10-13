import { describe, expect, it } from "vitest";
import { inventory } from "../../scripts/docs/inventory.ts";
import { GENERATED_MARK, renderReference } from "../../scripts/docs/sync.ts";

const deps = {
	nodes: { "demo/uno": { effect: 1, tier: "barato" } },
	workflows: {
		flujo: {
			agent: "demo",
			claims: "a",
			produces: null,
			nodes: ["demo/uno"],
			caps: { itemsPerTick: 2, costUsdPerRun: 0.5 },
		},
	},
	providers: {
		p: { capability: "crm", multiple: false, kind: "tool", authKind: "none" },
	},
};
const extras = {
	toolLabels: { hello: "Saludando" },
	toolsSinEtiqueta: [],
	servicesExcluidos: { "demo/helper": "ayuda a demo/uno" },
};

describe("renderReference", () => {
	it("produce las diez páginas generadas, con marca y frontmatter", async () => {
		const inv = await inventory("tests/fixtures/docs/repo-minimo", deps);
		const pages = renderReference(inv, extras);
		expect(Object.keys(pages).sort()).toEqual([
			"comandos.md",
			"evals.md",
			"migraciones.md",
			"nodos-y-workflows.md",
			"proveedores.md",
			"rutas.md",
			"schedules.md",
			"tablas.md",
			"tools-del-agente.md",
			"variables-de-entorno.md",
		]);
		for (const content of Object.values(pages)) {
			expect(content.startsWith("---\n")).toBe(true);
			expect(content).toContain("generated: true");
			expect(content).toContain("category: referencia");
			expect(content).toContain(GENERATED_MARK);
			expect(content).not.toMatch(/\d{4}-\d{2}-\d{2}T/);
		}
	});

	it("cada tool lleva su etiqueta o avisa que falta", async () => {
		const inv = await inventory("tests/fixtures/docs/repo-minimo", deps);
		const tools = renderReference(inv, extras)["tools-del-agente.md"];
		expect(tools).toContain("| `demo/hello` | Saludando |");
		expect(tools).toContain("| `demo/bye` | FALTA |");
	});

	it("es determinística", async () => {
		const inv = await inventory("tests/fixtures/docs/repo-minimo", deps);
		expect(renderReference(inv, extras)).toEqual(renderReference(inv, extras));
	});
});
