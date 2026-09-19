import { describe, expect, it } from "vitest";
import { toAccountRows } from "@/lib/outreach/cuentas-query";

const NOW = new Date("2026-09-19T12:00:00Z");

const ficha = (over: Record<string, unknown> = {}) => ({
	name: "Acme",
	domain: "acme.test",
	produce: "software",
	gana: "tiempo",
	compra: "consultoría",
	rompe_si_crece: "el soporte",
	gap_declarado: null,
	gap_demostrable: null,
	hechos: [{ hecho: "Abrió planta", url: "https://acme.test/n", fecha: null }],
	creditos_usados: 3,
	...over,
});

const raw = (over: Record<string, unknown> = {}) => ({
	id: "a1",
	domain: "acme.test",
	name: "Acme",
	researched_at: "2026-08-01T00:00:00Z",
	expires_at: "2026-10-30T00:00:00Z",
	ficha: ficha(),
	contacts: [{ count: 3 }],
	...over,
});

describe("toAccountRows", () => {
	it("aplana el conteo de contactos del embed", () => {
		const [row] = toAccountRows([raw()], NOW);

		expect(row.contactCount).toBe(3);
	});

	it("trae los campos de la ficha para mostrar en el detalle", () => {
		const [row] = toAccountRows([raw()], NOW);

		expect(row.ficha?.produce).toBe("software");
		expect(row.ficha?.hechos).toHaveLength(1);
	});

	it("marca vigente una ficha cuyo vencimiento es futuro", () => {
		const [row] = toAccountRows(
			[raw({ expires_at: "2026-10-30T00:00:00Z" })],
			NOW,
		);

		expect(row.vencida).toBe(false);
	});

	it("marca vencida una ficha cuyo vencimiento ya pasó", () => {
		const [row] = toAccountRows(
			[raw({ expires_at: "2026-09-01T00:00:00Z" })],
			NOW,
		);

		expect(row.vencida).toBe(true);
	});

	it("no revienta con una ficha que no matchea el schema", () => {
		const [row] = toAccountRows([raw({ ficha: { name: "Acme" } })], NOW);

		expect(row.ficha).toBeNull();
		// El resto de la fila sigue siendo útil aunque la ficha no parsee.
		expect(row.domain).toBe("acme.test");
	});

	it("un embed de contacts vacío cuenta cero, no explota", () => {
		const [row] = toAccountRows([raw({ contacts: [] })], NOW);

		expect(row.contactCount).toBe(0);
	});
});
