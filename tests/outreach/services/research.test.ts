import { describe, expect, it } from "vitest";
import type { Ficha } from "@/lib/outreach/ficha";
import {
	prepareResearch,
	researchMessage,
	saveResearch,
} from "@/lib/outreach/services/research";
import { createFakeStore, TENANT, USER } from "../fake-store";

const now = () => new Date("2026-09-15T12:00:00Z");
const ficha: Ficha = {
	name: "Acme",
	domain: "acme.test",
	produce: "Envases",
	gana: null,
	compra: null,
	rompe_si_crece: null,
	gap_declarado: null,
	gap_demostrable: null,
	hechos: [{ hecho: "Abrió planta", url: "https://acme.test/n", fecha: null }],
	creditos_usados: 1,
};

describe("prepareResearch", () => {
	it("rechaza un dominio inválido", async () => {
		const result = await prepareResearch(
			{ tenantId: TENANT, domain: "acme", name: null },
			{ store: createFakeStore(), now },
		);
		expect(result).toMatchObject({
			kind: "done",
			result: { ok: false, reason: "dominio_invalido" },
		});
	});

	it("devuelve la ficha vigente sin investigar", async () => {
		const store = createFakeStore();
		store.accounts.push({
			id: "a1",
			tenantId: TENANT,
			domain: "acme.test",
			name: "Acme",
			ficha,
			researchedAt: "2026-09-01T00:00:00Z",
			expiresAt: "2026-11-30T00:00:00Z",
		});
		expect(
			await prepareResearch(
				{ tenantId: TENANT, domain: "https://www.Acme.test/", name: null },
				{ store, now },
			),
		).toMatchObject({
			kind: "done",
			result: { ok: true, cached: true, domain: "acme.test" },
		});
	});

	it("con ficha vencida o sin ficha pide investigar con un mensaje que nombra el dominio", async () => {
		const store = createFakeStore();
		store.accounts.push({
			id: "a1",
			tenantId: TENANT,
			domain: "acme.test",
			name: "Acme",
			ficha,
			researchedAt: "2026-01-01T00:00:00Z",
			expiresAt: "2026-04-01T00:00:00Z",
		});
		const result = await prepareResearch(
			{ tenantId: TENANT, domain: "acme.test", name: "Acme SA" },
			{ store, now },
		);
		expect(result.kind).toBe("research");
		if (result.kind === "research")
			expect(result.message).toContain("acme.test");
	});
});

describe("saveResearch", () => {
	it("guarda la ficha saneada con vencimiento a 90 días y registra el evento", async () => {
		const store = createFakeStore();
		const raw = {
			...ficha,
			hechos: [...ficha.hechos, { hecho: "Sin fuente", url: "", fecha: null }],
		};
		const result = await saveResearch(
			{ tenantId: TENANT, userId: USER, domain: "acme.test", raw },
			{ store, now },
		);
		expect(result).toMatchObject({
			ok: true,
			cached: false,
			expiresAt: "2026-12-14T12:00:00.000Z",
		});
		expect(store.accounts[0].ficha.hechos).toHaveLength(1);
		expect(store.events.map((e) => e.type)).toEqual(["investigado"]);
	});

	it("una ficha sin ningún hecho con URL no se guarda", async () => {
		const store = createFakeStore();
		const result = await saveResearch(
			{
				tenantId: TENANT,
				userId: USER,
				domain: "acme.test",
				raw: { ...ficha, hechos: [{ hecho: "x", url: "", fecha: null }] },
			},
			{ store, now },
		);
		expect(result).toMatchObject({ ok: false, reason: "sin_ancla" });
		expect(store.accounts).toHaveLength(0);
	});

	it("una salida que no cumple el formato es ficha_invalida", async () => {
		const result = await saveResearch(
			{
				tenantId: TENANT,
				userId: USER,
				domain: "acme.test",
				raw: { nombre: "Acme" },
			},
			{ store: createFakeStore(), now },
		);
		expect(result).toMatchObject({ ok: false, reason: "ficha_invalida" });
	});
});

describe("researchMessage", () => {
	it("manda a leer la web con leer_pagina desde el dominio, sin fuentes pagas ni LinkedIn", () => {
		const message = researchMessage("acme.test", null);
		expect(message).not.toMatch(/linkedin|enriquecimiento|pagas/i);
		expect(message).toContain("https://acme.test");
		expect(message).toContain("leer_pagina");
	});
});
