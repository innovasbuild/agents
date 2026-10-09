import { describe, expect, it } from "vitest";
import { visibleNav } from "@/lib/tenants/nav";

const labels = (role: Parameters<typeof visibleNav>[0]) =>
	visibleNav(role).map((entry) => entry.label);

describe("visibleNav", () => {
	it("un miembro ve Conectar y no ve Configuración", () => {
		expect(labels("tenant_member")).toEqual([
			"Chat",
			"Outreach",
			"Brain",
			"Métricas",
			"Conectar",
		]);
	});

	it("un administrador ve además Configuración, al final", () => {
		expect(labels("tenant_admin")).toEqual([
			"Chat",
			"Outreach",
			"Brain",
			"Métricas",
			"Conectar",
			"Configuración",
		]);
		expect(labels("platform_admin")).toEqual(labels("tenant_admin"));
	});

	it("Conectar apunta a /conectar", () => {
		expect(visibleNav("tenant_member")).toContainEqual({
			href: "/conectar",
			label: "Conectar",
		});
	});
});
