// tests/brain/editor-rules-panel.test.ts
import { describe, expect, it, vi } from "vitest";
import { resolveAccess } from "@/lib/brain/core/access/resolve-access";
import type { AccessRule, Principal } from "@/lib/brain/core/access/types";
import {
	editorRules,
	loadFolderRulesPanel,
	loadRulesPanel,
	probeSlugFor,
} from "@/lib/brain/core/editor/rules-panel";
import type { RulePage } from "@/lib/brain/core/rules";
import { createWikiRules } from "@/lib/brain/core/rules-source";

const rule = (slug: string, body = `cuerpo de ${slug}`): RulePage => ({
	slug,
	status: "activo",
	revision: 1,
	body,
});

const PAGES = [
	rule("00-reglas", "cuerpo de la raíz"),
	rule("talento/personal/00-reglas", "cuerpo de personal"),
	rule("skills/00-reglas", "cuerpo de skills"),
];

const source = (pages: RulePage[] = PAGES) =>
	createWikiRules({
		tenantId: "t1",
		store: {
			listRulePages: async () => pages,
			listFolders: async () => [],
		},
	});

const members = (path: string, level: AccessRule["level"]): AccessRule => ({
	path,
	principal: "members",
	userId: null,
	level,
});
const user = (path: string, level: AccessRule["level"]): AccessRule => ({
	path,
	principal: "user",
	userId: "ana",
	level,
});
const ana: Principal = { kind: "user", userId: "ana", role: "tenant_member" };
const admin = () => "administrador" as const;
const accessOf = (rules: AccessRule[]) => (path: string) =>
	resolveAccess(rules, ana, path);
const noLog = () => {};

describe("loadRulesPanel", () => {
	it("trae la cascada de la raíz a la carpeta, con título y link", async () => {
		const view = await loadRulesPanel(
			editorRules(source(), admin),
			"talento/personal/leo",
			admin,
			noLog,
		);
		expect(view).toEqual({
			kind: "rules",
			entries: [
				{
					path: "",
					slug: "00-reglas",
					title: "Instrucciones del brain",
					body: "cuerpo de la raíz",
					visible: true,
				},
				{
					path: "talento/personal",
					slug: "talento/personal/00-reglas",
					title: "Reglas de talento/personal",
					body: "cuerpo de personal",
					visible: true,
				},
			],
		});
	});

	it("una ruta sin reglas no tiene panel", async () => {
		expect(
			await loadRulesPanel(
				editorRules(source([]), admin),
				"comercial/x",
				admin,
				noLog,
			),
		).toBeNull();
	});

	it("quien no ve la carpeta no recibe panel ni cuerpos", async () => {
		const levelOf = accessOf([
			members("", "lector"),
			members("talento", "ninguno"),
		]);
		const rules = editorRules(source(), levelOf);
		const page = await loadRulesPanel(
			rules,
			"talento/personal/leo",
			levelOf,
			noLog,
		);
		const folder = await loadFolderRulesPanel(
			rules,
			"talento/personal",
			levelOf,
			noLog,
		);
		expect(page).toBeNull();
		expect(folder).toBeNull();
		expect(JSON.stringify([page, folder])).not.toContain("cuerpo de");
	});

	it("una 00-reglas que gobierna lo que ve, pero que no puede abrir, llega sin link", async () => {
		const levelOf = accessOf([
			members("", "lector"),
			members("talento", "ninguno"),
			user("talento/personal/leo", "editor"),
		]);
		const view = await loadRulesPanel(
			editorRules(source(), levelOf),
			"talento/personal/leo",
			levelOf,
			noLog,
		);
		expect(
			view?.kind === "rules" && view.entries.map((e) => [e.slug, e.visible]),
		).toEqual([
			["00-reglas", true],
			["talento/personal/00-reglas", false],
		]);
	});

	it("bajo skills/ no hay panel, ni para un administrador", async () => {
		expect(
			await loadRulesPanel(
				editorRules(source(), admin),
				"skills/facturacion",
				admin,
				noLog,
			),
		).toBeNull();
	});

	it("una 00-reglas muestra solo las de arriba", async () => {
		const view = await loadRulesPanel(
			editorRules(source(), admin),
			"talento/personal/00-reglas",
			admin,
			noLog,
		);
		expect(view?.kind === "rules" && view.entries.map((e) => e.slug)).toEqual([
			"00-reglas",
		]);
	});

	it("si la lectura falla, avisa sin romper el editor y lo deja en el log", async () => {
		const onError = vi.fn();
		const broken = editorRules(
			createWikiRules({
				tenantId: "t1",
				store: {
					listRulePages: async () => {
						throw new Error("rpc caído");
					},
					listFolders: async () => [],
				},
			}),
			admin,
		);
		const view = await loadRulesPanel(broken, "comercial/x", admin, onError);
		expect(view).toMatchObject({ kind: "error" });
		expect(onError).toHaveBeenCalledOnce();
	});
});

describe("loadFolderRulesPanel", () => {
	it("pide la cascada de una página nueva en esa carpeta", async () => {
		expect(probeSlugFor("")).toBe("nueva-pagina");
		expect(probeSlugFor("talento/personal")).toBe(
			"talento/personal/nueva-pagina",
		);
		const view = await loadFolderRulesPanel(
			editorRules(source(), admin),
			"talento/personal",
			admin,
			noLog,
		);
		expect(view?.kind === "rules" && view.entries.map((e) => e.path)).toEqual([
			"",
			"talento/personal",
		]);
	});

	it("una carpeta inválida no tiene panel", async () => {
		expect(
			await loadFolderRulesPanel(
				editorRules(source(), admin),
				"Talento",
				admin,
				noLog,
			),
		).toBeNull();
	});
});
