// Value: protects=el bloque de arranque del brain en el chat trae las instrucciones de la raíz y solo las carpetas que la persona ve; fails_when=un miembro que no ve nada recibe las instrucciones, un brain mcp arma bloque o se nombra una carpeta oculta; why_new=session.test.ts cubre el formato y handler el MCP, no la resolución por persona del chat; seam=deps; no_claim=lectura real de Supabase y cómo eve inyecta las instrucciones
import { describe, expect, it } from "vitest";
import { brainSessionInstructions } from "@/lib/brain/adapters/session-instructions";
import type { AccessRule } from "@/lib/brain/core/access/types";
import { createWikiRules } from "@/lib/brain/core/rules-source";

const wikiConnection = {
	id: "b1",
	tenantId: "t1",
	capability: "brain",
	provider: "wiki",
	connectorUid: null,
	config: {
		categories: ["talento", "direccion"],
		requiredFrontmatter: [],
		search: "fts",
	},
};

const rulesSource = () =>
	createWikiRules({
		tenantId: "t1",
		store: {
			listRulePages: async () => [
				{
					slug: "00-reglas",
					status: "activo",
					revision: 1,
					body: "Tercera persona.",
				},
			],
			listFolders: async () => [
				{ path: "talento", description: "Personas" },
				{ path: "direccion", description: "Presupuesto" },
			],
		},
	});

const deps = (rules: AccessRule[] = []) => ({
	bindings: async () => [wikiConnection],
	rulesSource,
	rules: async () => rules,
});

describe("brainSessionInstructions", () => {
	it("trae las instrucciones y las carpetas que la persona ve", async () => {
		const text = await brainSessionInstructions(
			"t1",
			{ userId: "ana", role: "tenant_member" },
			deps([
				{
					path: "direccion",
					principal: "members",
					userId: null,
					level: "ninguno",
				},
			]),
		);
		expect(text).toContain("Tercera persona.");
		expect(text).toContain("| talento | Personas |");
		expect(text).not.toContain("direccion");
	});

	it("sin persona (agente desatendido) nombra todas las carpetas", async () => {
		const text = await brainSessionInstructions("t1", undefined, {
			bindings: async () => [wikiConnection],
			rulesSource,
		});
		expect(text).toContain("| direccion | Presupuesto |");
	});

	it("sin brain no hay bloque", async () => {
		expect(
			await brainSessionInstructions("t1", undefined, {
				bindings: async () => [],
				rulesSource,
			}),
		).toBeNull();
	});

	it("un brain externo por mcp no tiene bloque", async () => {
		expect(
			await brainSessionInstructions("t1", undefined, {
				bindings: async () => [
					{
						...wikiConnection,
						provider: "mcp",
						connectorUid: "c1",
						config: {
							url: "https://brain.example.com/mcp",
							categories: ["talento"],
						},
					},
				],
				rulesSource,
			}),
		).toBeNull();
	});

	// Sin reglas de acceso un miembro lee la raíz como lector (resolve-access):
	// recibe las instrucciones.
	it("un miembro sin reglas recibe las instrucciones de la raíz", async () => {
		const text = await brainSessionInstructions(
			"t1",
			{ userId: "ana", role: "tenant_member" },
			deps(),
		);
		expect(text).toContain("Tercera persona.");
		expect(text).toContain("| direccion | Presupuesto |");
	});

	it("un miembro que no ve nada del brain no recibe bloque", async () => {
		const text = await brainSessionInstructions(
			"t1",
			{ userId: "ana", role: "tenant_member" },
			deps([
				{ path: "", principal: "members", userId: null, level: "ninguno" },
			]),
		);
		expect(text).toBeNull();
	});

	// Mismo criterio que el MCP: ve alguna parte por la ruta de una regla suya.
	it("un miembro que ve solo una subcarpeta recibe las instrucciones de la raíz", async () => {
		const text = await brainSessionInstructions(
			"t1",
			{ userId: "ana", role: "tenant_member" },
			deps([
				{ path: "", principal: "members", userId: null, level: "ninguno" },
				{
					path: "talento/equipo",
					principal: "user",
					userId: "ana",
					level: "lector",
				},
			]),
		);
		expect(text).toContain("Tercera persona.");
		expect(text).not.toContain("| talento |");
	});

	it("un administrador recibe las instrucciones aunque la raíz esté cerrada", async () => {
		const text = await brainSessionInstructions(
			"t1",
			{ userId: "jefa", role: "tenant_admin" },
			deps([
				{ path: "", principal: "members", userId: null, level: "ninguno" },
			]),
		);
		expect(text).toContain("Tercera persona.");
		expect(text).toContain("| direccion | Presupuesto |");
	});
});
