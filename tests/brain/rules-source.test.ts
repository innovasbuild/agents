// tests/brain/rules-source.test.ts
import { describe, expect, it } from "vitest";
import {
	BrainForbidden,
	BrainNotFound,
	BrainRulesRequired,
} from "@/lib/brain/core/errors";
import type { RulePage } from "@/lib/brain/core/rules";
import {
	createWikiRules,
	EMPTY_RULES,
	requireRules,
	withRulesAccess,
} from "@/lib/brain/core/rules-source";
import type { BrainWrite } from "@/lib/brain/core/types";

const rule = (
	slug: string,
	revision = 1,
	status: RulePage["status"] = "activo",
): RulePage => ({
	slug,
	status,
	revision,
	body: `reglas de ${slug}`,
});

function source(pages: RulePage[]) {
	return createWikiRules({
		tenantId: "t1",
		store: {
			listRulePages: async (tenantId) => (tenantId === "t1" ? pages : []),
			listFolders: async () => [
				{ path: "talento", description: "Personas" },
				{ path: "talento/personal", description: "" },
				{ path: "direccion", description: "Presupuesto" },
				{ path: "skills", description: "" },
			],
		},
	});
}

const write = (slug: string, extra: Partial<BrainWrite> = {}): BrainWrite => ({
	slug,
	title: "T",
	category: "talento",
	status: "activo",
	tags: [],
	body: "b",
	reason: "alta",
	...extra,
});

describe("createWikiRules", () => {
	it("arma la cascada de una ruta con las 00-reglas del tenant", async () => {
		const cascade = await source([
			rule("00-reglas"),
			rule("talento/personal/00-reglas"),
		]).cascade("talento/personal/leo");
		expect(cascade.chain.map((e) => e.path)).toEqual(["", "talento/personal"]);
	});

	it("rechaza una ruta inválida y acepta la raíz", async () => {
		await expect(source([]).cascade("Talento/x")).rejects.toMatchObject({
			fields: ["path"],
		});
		expect((await source([rule("00-reglas")]).cascade("")).chain).toHaveLength(
			1,
		);
	});

	it("el arranque trae la raíz activa y las carpetas de primer nivel sin skills", async () => {
		const context = await source([rule("00-reglas", 4)]).session();
		expect(context.root).toEqual({
			path: "",
			slug: "00-reglas",
			revision: 4,
			body: "reglas de 00-reglas",
		});
		expect(context.folders.map((f) => f.path)).toEqual([
			"talento",
			"direccion",
		]);
		expect(
			(await source([rule("00-reglas", 4, "archivado")]).session()).root,
		).toBeNull();
	});

	it("EMPTY_RULES no tiene reglas ni arranque", async () => {
		expect(await EMPTY_RULES.cascade("x/y")).toEqual({
			revision: "",
			chain: [],
			fields: [],
			template: null,
		});
		expect(await EMPTY_RULES.session()).toEqual({ root: null, folders: [] });
	});
});

describe("withRulesAccess", () => {
	const levelOf = (path: string) =>
		path === "direccion" || path.startsWith("direccion/")
			? null
			: ("lector" as const);

	it("una ruta que la persona no ve responde not_found", async () => {
		const guarded = withRulesAccess(
			source([rule("direccion/00-reglas")]),
			levelOf,
		);
		await expect(guarded.cascade("direccion/x")).rejects.toBeInstanceOf(
			BrainNotFound,
		);
	});

	it("una 00-reglas que gobierna una ruta visible llega aunque la persona no la pueda leer", async () => {
		const onlyFolder = (path: string) =>
			path === "talento/personal/00-reglas" ? null : ("lector" as const);
		const guarded = withRulesAccess(
			source([rule("talento/personal/00-reglas")]),
			onlyFolder,
		);
		expect((await guarded.cascade("talento/personal/leo")).chain).toHaveLength(
			1,
		);
	});

	it("el arranque solo nombra las carpetas que la persona ve", async () => {
		const guarded = withRulesAccess(source([rule("00-reglas")]), levelOf);
		const context = await guarded.session();
		expect(context.root).not.toBeNull();
		expect(context.folders.map((f) => f.path)).toEqual(["talento"]);
	});
});

describe("requireRules", () => {
	const rules = source([
		rule("00-reglas", 2),
		rule("talento/personal/00-reglas", 5),
	]);

	it("una ruta sin reglas escribe con un rulesRevision espurio", async () => {
		const out = await requireRules(
			source([]),
			write("talento/leo", { rulesRevision: "ffffffffffffffff" }),
		);
		expect(out).not.toHaveProperty("rulesRevision");
		expect(out.slug).toBe("talento/leo");
	});

	it("sin rulesRevision devuelve la cascada completa, raíz incluida", async () => {
		const error = await requireRules(
			rules,
			write("talento/personal/leo"),
		).catch((e) => e);
		expect(error).toBeInstanceOf(BrainRulesRequired);
		expect(
			(error as BrainRulesRequired).rules.chain.map((e) => e.path),
		).toEqual(["", "talento/personal"]);
		expect((error as BrainRulesRequired).message).toContain("tiene reglas");
	});

	it("con la revisión vigente escribe, sin pasar rulesRevision", async () => {
		const current = (await rules.cascade("talento/personal/leo")).revision;
		const out = await requireRules(
			rules,
			write("talento/personal/leo", { rulesRevision: current }),
		);
		expect(out).not.toHaveProperty("rulesRevision");
	});

	it("solo la raíz con reglas también exige", async () => {
		const error = await requireRules(
			source([rule("00-reglas")]),
			write("talento/leo"),
		).catch((e) => e);
		expect(error).toBeInstanceOf(BrainRulesRequired);
	});

	it("una 00-reglas archivada cambia la revisión: el valor viejo pide releer", async () => {
		const before = (await rules.cascade("talento/personal/leo")).revision;
		const after = source([
			rule("00-reglas", 2),
			rule("talento/personal/00-reglas", 5, "archivado"),
		]);
		const error = await requireRules(
			after,
			write("talento/personal/leo", { rulesRevision: before }),
		).catch((e) => e);
		expect(error).toBeInstanceOf(BrainRulesRequired);
		expect((error as BrainRulesRequired).message).toContain("cambiaron");
		expect(
			(error as BrainRulesRequired).rules.chain.map((e) => e.path),
		).toEqual([""]);
	});

	it("una 00-reglas archivada que deja la cadena vacía deja escribir con el valor viejo", async () => {
		const before = (
			await source([rule("talento/00-reglas")]).cascade("talento/leo")
		).revision;
		const after = source([rule("talento/00-reglas", 1, "archivado")]);
		await expect(
			requireRules(after, write("talento/leo", { rulesRevision: before })),
		).resolves.toMatchObject({
			slug: "talento/leo",
		});
	});

	it("una ruta oculta se rechaza como withAccess: forbidden al crear, not_found al actualizar", async () => {
		const hidden = withRulesAccess(rules, () => null);
		await expect(
			requireRules(hidden, write("talento/personal/leo")),
		).rejects.toBeInstanceOf(BrainForbidden);
		await expect(
			requireRules(hidden, write("talento/personal/leo", { baseRevision: 2 })),
		).rejects.toBeInstanceOf(BrainNotFound);
	});
});
