// tests/outreach/canon-blocks.test.ts
import { describe, expect, it } from "vitest";
import {
	icpRevision,
	parseIcpBlocks,
	parseMarcoBlocks,
} from "@/lib/outreach/canon-blocks";

const ICP = [
	"# ICP",
	"",
	"Prosa que no cuenta. encaje: esto no es un nivel",
	"",
	"```icp",
	"# comentario",
	"encaje: No es del universo: rubro ajeno o tamaño fuera de rango",
	"encaje: Encaja bien: tamaño y rubro del perfil buscado   # alta 2026-10-10",
	"rol: Sin relación con esta decisión de compra",
	"rol: Decide: tiene control sobre el presupuesto",
	"excluir: La empresa es competidora, cliente o proveedora",
	"```",
].join("\n");

const icpPage = (body = ICP, slug = "comercial/icp") => ({ slug, body });

describe("parseIcpBlocks", () => {
	it("lee los niveles en orden y conserva los dos puntos del texto", () => {
		expect(parseIcpBlocks([icpPage()])).toEqual({
			icp: {
				encaje_empresa: [
					"No es del universo: rubro ajeno o tamaño fuera de rango",
					"Encaja bien: tamaño y rubro del perfil buscado",
				],
				rol_decisor: [
					"Sin relación con esta decisión de compra",
					"Decide: tiene control sobre el presupuesto",
				],
				excluir: "La empresa es competidora, cliente o proveedora",
			},
			blocks: 1,
			errors: [],
		});
	});

	it("sin bloque no hay ICP ni errores", () => {
		expect(parseIcpBlocks([icpPage("# ICP\n\nsolo prosa")])).toEqual({
			icp: null,
			blocks: 0,
			errors: [],
		});
	});

	it("dos bloques es un error que nombra las páginas", () => {
		const result = parseIcpBlocks([
			icpPage(),
			icpPage(ICP, "comercial/icp-viejo"),
		]);
		expect(result.icp).toBeNull();
		expect(result.errors).toEqual([
			"hay más de un bloque icp: comercial/icp, comercial/icp-viejo. Dejá uno solo.",
		]);
	});

	it("un bloque solo con comentarios (la plantilla) no es un ICP", () => {
		const result = parseIcpBlocks([
			icpPage("```icp\n# encaje: completar\n```"),
		]);
		expect(result.icp).toBeNull();
		expect(result.errors).toEqual([
			"comercial/icp: el bloque icp necesita entre 2 y 10 líneas encaje (tiene 0)",
			"comercial/icp: el bloque icp necesita entre 2 y 10 líneas rol (tiene 0)",
			"comercial/icp: el bloque icp necesita exactamente una línea excluir (tiene 0)",
		]);
	});

	it("nivel corto, directiva desconocida y dos excluir: cada uno con página y línea", () => {
		const body = [
			"```icp",
			"encaje: corto",
			"encaje: Encaja bien: tamaño y rubro del perfil buscado",
			"rol: Sin relación con esta decisión de compra",
			"rol: Decide: tiene control sobre el presupuesto",
			"excluir: La empresa es competidora, cliente o proveedora",
			"excluir: La empresa cerró o está en concurso",
			"umbral: 2",
			"```",
		].join("\n");
		const result = parseIcpBlocks([icpPage(body)]);
		expect(result.icp).toBeNull();
		expect(result.errors).toEqual([
			"comercial/icp, línea 2: el nivel tiene que tener entre 10 y 400 caracteres",
			'comercial/icp, línea 8: directiva no reconocida: "umbral: 2"',
			"comercial/icp: el bloque icp necesita exactamente una línea excluir (tiene 2)",
		]);
	});
});

describe("parseMarcoBlocks", () => {
	const hooks = (slug: string, lines: string[]) => ({
		slug,
		body: ["```hooks", ...lines, "```"].join("\n"),
	});
	const vectores = (slug: string, lines: string[]) => ({
		slug,
		body: ["texto", "", "```vectores", ...lines, "```"].join("\n"),
	});

	it("suma bloques de varias páginas y lee el hook por defecto", () => {
		expect(
			parseMarcoBlocks([
				hooks("comercial/hooks", [
					"h_uno: Hook uno",
					"h_dos: Dolor: perdió algo",
				]),
				vectores("comercial/vectores", [
					"v_uno: Vector uno => h_dos",
					"v_dos: Sin hook por defecto",
				]),
			]),
		).toEqual({
			hooks: [
				{ value: "h_uno", label: "Hook uno" },
				{ value: "h_dos", label: "Dolor: perdió algo" },
			],
			vectores: [
				{ value: "v_uno", label: "Vector uno", default_hook: "h_dos" },
				{ value: "v_dos", label: "Sin hook por defecto", default_hook: null },
			],
			blocks: 2,
			errors: [],
		});
	});

	it("sin bloques no hay listas ni errores", () => {
		expect(parseMarcoBlocks([{ slug: "p", body: "prosa" }])).toEqual({
			hooks: [],
			vectores: [],
			blocks: 0,
			errors: [],
		});
	});

	it("el mismo hook en dos páginas es un error que nombra las dos", () => {
		const result = parseMarcoBlocks([
			hooks("a", ["h_uno: Uno"]),
			hooks("b", ["h_uno: Otra vez"]),
			vectores("a2", ["v_uno: Vector"]),
		]);
		expect(result.errors).toEqual([
			'b, línea 2: el hook "h_uno" ya está en a, línea 2',
		]);
	});

	it("identificador inválido, hook por defecto inexistente y clase vacía", () => {
		expect(
			parseMarcoBlocks([
				hooks("a", ["H Uno: Mayúsculas y espacio"]),
				vectores("a2", ["v_uno: Vector => h_no_existe"]),
			]).errors,
		).toEqual([
			'a, línea 2: identificador inválido: "H Uno" (minúsculas, dígitos y guion bajo)',
			'a2, línea 4: el vector "v_uno" apunta al hook "h_no_existe", que no está en ningún bloque hooks',
			"faltan hooks: tiene que haber al menos uno en un bloque hooks",
		]);
	});

	it("solo hooks, sin vectores, es un error", () => {
		expect(parseMarcoBlocks([hooks("a", ["h_uno: Uno"])]).errors).toEqual([
			"faltan vectores: tiene que haber al menos uno en un bloque vectores",
		]);
	});
});

describe("icpRevision", () => {
	const base = parseIcpBlocks([icpPage()]).icp;
	if (!base) throw new Error("fixture inválido");

	it("es estable ante espacios y cambia con un nivel", () => {
		const spaced = parseIcpBlocks([
			icpPage(ICP.replace("rol: Sin relación", "rol:    Sin   relación")),
		]).icp;
		const changed = {
			...base,
			excluir:
				"La empresa es competidora, cliente, proveedora o está en concurso",
		};
		expect(icpRevision(base)).toMatch(/^[0-9a-f]{16}$/);
		expect(spaced && icpRevision(spaced)).toBe(icpRevision(base));
		expect(icpRevision(changed)).not.toBe(icpRevision(base));
	});
});
