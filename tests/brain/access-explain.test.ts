import { describe, expect, it } from "vitest";
import { explainAccess } from "@/lib/brain/core/access/explain";
import type { AccessRule } from "@/lib/brain/core/access/types";

const members = (path: string, level: AccessRule["level"]): AccessRule => ({
	path,
	principal: "members",
	userId: null,
	level,
});
const user = (
	path: string,
	userId: string,
	level: AccessRule["level"],
): AccessRule => ({ path, principal: "user", userId, level });

describe("explainAccess", () => {
	it("sin reglas, el acceso general efectivo es lector por defecto", () => {
		expect(explainAccess([], "comercial")).toEqual({
			path: "comercial",
			own: [],
			inherited: [],
			general: {
				own: null,
				inherited: { level: "lector", from: null },
				effective: "lector",
			},
		});
	});

	it("separa las reglas propias de las heredadas y dice de dónde vienen", () => {
		const rules = [
			members("", "lector"),
			user("comercial", "ana", "editor"),
			user("comercial/icp", "beto", "lector"),
		];
		const view = explainAccess(rules, "comercial/icp");
		expect(view.own).toEqual([{ userId: "beto", level: "lector" }]);
		expect(view.inherited).toEqual([
			{ userId: "ana", level: "editor", from: "comercial" },
		]);
		expect(view.general.inherited).toEqual({ level: "lector", from: "" });
	});

	it("el acceso general propio gana sobre el heredado", () => {
		const rules = [members("", "lector"), members("legal", "ninguno")];
		const view = explainAccess(rules, "legal");
		expect(view.general).toEqual({
			own: "ninguno",
			inherited: { level: "lector", from: "" },
			effective: "ninguno",
		});
	});

	it("hereda del ancestro más cercano que tenga acceso general", () => {
		const rules = [
			members("", "lector"),
			members("legal", "ninguno"),
			members("legal/contratos", "editor"),
		];
		const view = explainAccess(rules, "legal/contratos/2027");
		expect(view.general.inherited).toEqual({
			level: "editor",
			from: "legal/contratos",
		});
		expect(view.general.effective).toBe("editor");
	});

	it("de una persona con reglas en varios ancestros muestra el nivel más alto", () => {
		const rules = [
			user("a", "ana", "lector"),
			user("a/b", "ana", "administrador"),
		];
		expect(explainAccess(rules, "a/b/c").inherited).toEqual([
			{ userId: "ana", level: "administrador", from: "a/b" },
		]);
	});

	it("la raíz no hereda nada", () => {
		const view = explainAccess([members("", "editor")], "");
		expect(view.general).toEqual({
			own: "editor",
			inherited: { level: "lector", from: null },
			effective: "editor",
		});
		expect(view.inherited).toEqual([]);
	});
});
