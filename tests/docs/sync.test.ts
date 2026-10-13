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

describe("renderReference, casos de borde", () => {
	const empty = {
		tools: [],
		schedules: [],
		nodes: [],
		workflows: [],
		tables: [],
		migrations: [],
		routes: [],
		providers: [],
		scripts: [],
		envVars: [],
		evals: [],
		specs: [],
	};

	it("una tabla sin filas dice que no hay ninguno", () => {
		const pages = renderReference(empty, {
			toolLabels: {},
			toolsSinEtiqueta: [],
			servicesExcluidos: {},
		});
		expect(pages["schedules.md"]).toContain("_Ninguno._");
	});

	it("una tool sin etiqueta a propósito lo dice", () => {
		const pages = renderReference(
			{
				...empty,
				tools: [{ key: "demo/spike", path: "agents/demo/tools/spike.ts" }],
			},
			{ toolLabels: {}, toolsSinEtiqueta: ["spike"], servicesExcluidos: {} },
		);
		expect(pages["tools-del-agente.md"]).toContain(
			"| `demo/spike` | sin etiqueta a propósito |",
		);
	});

	it("escapa las barras verticales de los comandos", () => {
		const pages = renderReference(
			{
				...empty,
				scripts: [
					{ key: "x", path: "package.json", meta: { command: "a | b" } },
				],
			},
			{ toolLabels: {}, toolsSinEtiqueta: [], servicesExcluidos: {} },
		);
		expect(pages["comandos.md"]).toContain("`a \\| b`");
	});

	it("resume los archivos que leen una variable después de tres", () => {
		const files = ["a.ts", "b.ts", "c.ts", "d.ts", "e.ts"];
		const pages = renderReference(
			{
				...empty,
				envVars: [
					{ key: "FOO", path: "a.ts", meta: { files: files.join(",") } },
				],
			},
			{ toolLabels: {}, toolsSinEtiqueta: [], servicesExcluidos: {} },
		);
		expect(pages["variables-de-entorno.md"]).toContain(
			"`a.ts`, `b.ts`, `c.ts` y 2 más",
		);
	});

	it("la fila de un workflow lleva nodos y caps", async () => {
		const inv = await inventory("tests/fixtures/docs/repo-minimo", deps);
		expect(renderReference(inv, extras)["nodos-y-workflows.md"]).toContain(
			"| `flujo` | demo | `a` | — | `demo/uno` | 2 ítems por tick · USD 0.5 por corrida |",
		);
	});
});
