import { describe, expect, it } from "vitest";
import { settingsSections } from "@/lib/tenants/settings-sections";

describe("settingsSections", () => {
	it("con outreach y asistente muestra todo", () => {
		expect(settingsSections(["outreach", "asistente"], 0)).toEqual({
			model: true,
			executors: true,
			approvals: true,
			connections: true,
		});
	});

	it("solo con asistente no muestra nada propio de outreach", () => {
		expect(settingsSections(["asistente"], 0)).toEqual({
			model: true,
			executors: false,
			approvals: false,
			connections: true,
		});
	});

	it("solo con asistente muestra Aprobaciones si algún agente tiene algo para aprobar", () => {
		expect(settingsSections(["asistente"], 2).approvals).toBe(true);
	});

	it("sin agentes oculta todo", () => {
		expect(settingsSections([], 0)).toEqual({
			model: false,
			executors: false,
			approvals: false,
			connections: false,
		});
	});

	it("si no se pudieron leer los agentes muestra todo", () => {
		expect(settingsSections(null, 0)).toEqual({
			model: true,
			executors: true,
			approvals: true,
			connections: true,
		});
	});
});
