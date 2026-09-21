// Guardias estructurales del dispatcher: corre cada 5 minutos, no tiene camino
// de envío ni de CRM, y corta la llamada al modelo con el tope por ítem.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const SOURCE = readFileSync(
	join(
		__dirname,
		"..",
		"..",
		"..",
		"agents",
		"outreach",
		"schedules",
		"dispatch.ts",
	),
	"utf8",
);

describe("schedule dispatch", () => {
	it("corre cada 5 minutos", () => {
		expect(SOURCE).toMatch(/cron:\s*"\*\/5 \* \* \* \*"/);
	});

	it("no importa nada del camino de envío ni del CRM", () => {
		// Un workflow desatendido nunca le llega a una persona (spec §5.2 punto 6):
		// que no haya ni el import es la garantía, no una promesa.
		expect(SOURCE).not.toMatch(/gmail\/send|services\/send|connectors\/crm/);
	});

	it("corta cada llamada al modelo con el tope por ítem del dispatcher", () => {
		expect(SOURCE).toMatch(/AbortSignal\.timeout\(ITEM_TIMEOUT_MS\)/);
	});

	it("asienta el consumo en la pasada del runner, con el nombre del workflow", () => {
		expect(SOURCE).toMatch(/workflow:\s*"refresh-fichas"/);
		expect(SOURCE).toMatch(/node:\s*"outreach\/research"/);
	});
});
