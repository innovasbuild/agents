import { describe, expect, it } from "vitest";
import { visibleNav, visibleUserNav } from "@/lib/tenants/nav";

const labels = (
	role: Parameters<typeof visibleNav>[0],
	agents: readonly string[] | null = ["outreach"],
) => visibleNav(role, agents).map((entry) => entry.label);

const userLabels = (
	role: Parameters<typeof visibleNav>[0],
	agents: readonly string[] | null = ["outreach"],
) => visibleUserNav(role, agents).map((link) => link.label);

describe("visibleNav", () => {
	it("con outreach, la tira muestra Chat, Outreach y Brain", () => {
		expect(labels("tenant_member")).toEqual(["Chat", "Outreach", "Brain"]);
		expect(labels("tenant_admin")).toEqual(labels("tenant_member"));
		expect(labels("platform_admin")).toEqual(labels("tenant_member"));
	});

	it("sin agentes, la tira muestra solo Brain", () => {
		expect(labels("tenant_member", [])).toEqual(["Brain"]);
	});

	it("si no se pudieron leer los agentes, no se oculta nada", () => {
		expect(labels("tenant_member", null)).toEqual(labels("tenant_member"));
	});

	it("un desplegable sin ítems visibles no se muestra", () => {
		expect(labels("tenant_admin", [])).not.toContain("Outreach");
	});

	it("solo con el asistente, un miembro ve Chat y Brain", () => {
		expect(labels("tenant_member", ["asistente"])).toEqual(["Chat", "Brain"]);
	});

	it("con un agente fuera del catálogo no hay Chat", () => {
		expect(labels("tenant_member", ["soporte"])).toEqual(["Brain"]);
	});

	it("Métricas vive dentro de Outreach y desaparece sin ese agente", () => {
		const outreach = visibleNav("tenant_member", ["outreach"]).find(
			(e) => e.label === "Outreach",
		);
		expect(outreach).toMatchObject({
			items: expect.arrayContaining([
				expect.objectContaining({ href: "/metricas", label: "Métricas" }),
			]),
		});
		expect(labels("tenant_member", ["asistente"])).not.toContain("Métricas");
	});
});

describe("visibleUserNav", () => {
	it("con outreach, un miembro ve Conectar y Mis cuentas, sin Configuración", () => {
		expect(userLabels("tenant_member")).toEqual(["Conectar", "Mis cuentas"]);
	});

	it("un administrador ve además Configuración, al final", () => {
		expect(userLabels("tenant_admin")).toEqual([
			"Conectar",
			"Mis cuentas",
			"Configuración",
		]);
		expect(userLabels("platform_admin")).toEqual(userLabels("tenant_admin"));
	});

	it("sin agentes no hay Mis cuentas", () => {
		expect(userLabels("tenant_member", [])).toEqual(["Conectar"]);
		expect(userLabels("tenant_admin", [])).toEqual([
			"Conectar",
			"Configuración",
		]);
	});

	it("si no se pudieron leer los agentes, no se oculta nada", () => {
		expect(userLabels("tenant_member", null)).toEqual(
			userLabels("tenant_member"),
		);
	});

	it("Conectar apunta a /conectar y Mis cuentas a /mis-cuentas", () => {
		const links = visibleUserNav("tenant_member", ["outreach"]);
		expect(links).toContainEqual({ href: "/conectar", label: "Conectar" });
		expect(links).toContainEqual(
			expect.objectContaining({ href: "/mis-cuentas" }),
		);
	});
});
