import { describe, expect, it } from "vitest";
import { visibleNav } from "@/lib/tenants/nav";

const labels = (
	role: Parameters<typeof visibleNav>[0],
	agents: readonly string[] | null = ["outreach"],
) => visibleNav(role, agents).map((entry) => entry.label);

describe("visibleNav", () => {
	it("con outreach, un miembro ve todo menos Configuración", () => {
		expect(labels("tenant_member")).toEqual([
			"Chat",
			"Outreach",
			"Brain",
			"Métricas",
			"Conectar",
			"Mis cuentas",
		]);
	});

	it("con outreach, un administrador ve además Configuración, al final", () => {
		expect(labels("tenant_admin")).toEqual([
			"Chat",
			"Outreach",
			"Brain",
			"Métricas",
			"Conectar",
			"Mis cuentas",
			"Configuración",
		]);
		expect(labels("platform_admin")).toEqual(labels("tenant_admin"));
	});

	it("sin agentes, un miembro ve solo Brain y Conectar", () => {
		expect(labels("tenant_member", [])).toEqual(["Brain", "Conectar"]);
	});

	it("sin agentes, un administrador ve Brain, Conectar y Configuración", () => {
		expect(labels("tenant_admin", [])).toEqual([
			"Brain",
			"Conectar",
			"Configuración",
		]);
	});

	it("si no se pudieron leer los agentes, no se oculta nada", () => {
		expect(labels("tenant_member", null)).toEqual(labels("tenant_member"));
	});

	it("un desplegable sin ítems visibles no se muestra", () => {
		expect(labels("tenant_admin", [])).not.toContain("Outreach");
	});

	it("solo con el asistente, un miembro ve Chat, Brain y Conectar", () => {
		expect(labels("tenant_member", ["asistente"])).toEqual([
			"Chat",
			"Brain",
			"Conectar",
		]);
	});

	it("con un agente fuera del catálogo no hay Chat", () => {
		expect(labels("tenant_member", ["soporte"])).toEqual(["Brain", "Conectar"]);
	});

	it("Conectar apunta a /conectar", () => {
		expect(visibleNav("tenant_member", [])).toContainEqual({
			href: "/conectar",
			label: "Conectar",
		});
	});

	it("Mis cuentas apunta a /mis-cuentas y la ve cualquier rol", () => {
		const entry = visibleNav("tenant_member", ["outreach"]).find(
			(e) => e.label === "Mis cuentas",
		);
		expect(entry).toMatchObject({ href: "/mis-cuentas" });
	});
});
