import { describe, expect, it, vi } from "vitest";
import type { Ficha } from "@/lib/outreach/ficha";
import {
	prepareResearch,
	researchAccount,
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
	dolores: [
		{
			dolor: "Coordinar pedidos entre plantas",
			por_que_a_ellos: "Abrió una planta nueva",
			beneficio: "Menos pedidos demorados",
			evidencia: "https://acme.test/n",
		},
	],
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

	it("una ficha vigente con hechos y sin dolores es de antes de los dolores: se vuelve a investigar", async () => {
		const store = createFakeStore();
		store.accounts.push({
			id: "a1",
			tenantId: TENANT,
			domain: "acme.test",
			name: "Acme",
			ficha: { ...ficha, dolores: [] },
			researchedAt: "2026-09-01T00:00:00Z",
			expiresAt: "2026-11-30T00:00:00Z",
		});
		expect(
			await prepareResearch(
				{ tenantId: TENANT, domain: "acme.test", name: null },
				{ store, now },
			),
		).toMatchObject({ kind: "research", domain: "acme.test" });
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

describe("researchAccount", () => {
	const vencida = {
		id: "a1",
		tenantId: TENANT,
		domain: "acme.test",
		name: "Acme",
		ficha,
		researchedAt: "2026-05-01T12:00:00.000Z",
		expiresAt: "2026-07-30T12:00:00.000Z",
	};
	const readPage = async () => ({
		ok: false as const,
		reason: "x",
		message: "x",
	});

	it("con ficha vigente la devuelve sin llamar al modelo", async () => {
		const store = createFakeStore();
		store.accounts.push({ ...vencida, expiresAt: "2026-12-01T12:00:00.000Z" });
		const generate = vi.fn();

		const result = await researchAccount(
			{ tenantId: TENANT, userId: USER, domain: "acme.test", name: null },
			{ store, now, readPage, generate },
		);

		expect(result).toMatchObject({ ok: true, cached: true });
		expect(generate).not.toHaveBeenCalled();
	});

	it("con ficha vencida investiga con el modelo del tenant y guarda; sin persona, el evento queda sin actor", async () => {
		const store = createFakeStore();
		// Copia: upsertAccount muta el objeto guardado in place, y `vencida` es
		// compartido entre tests de este describe.
		store.accounts.push({ ...vencida });
		const generate = vi.fn(async () => ({ output: ficha, pagesRead: 1 }));

		const result = await researchAccount(
			{ tenantId: TENANT, userId: null, domain: "acme.test", name: "Acme" },
			{ store, now, readPage, generate },
		);

		expect(result).toMatchObject({
			ok: true,
			cached: false,
			domain: "acme.test",
		});
		expect(generate).toHaveBeenCalledWith(
			expect.objectContaining({
				model: store.tenants.get(TENANT)?.config.models.researcher,
			}),
		);
		expect(store.accounts[0].researchedAt).toBe(now().toISOString());
		expect(store.events.at(-1)).toMatchObject({
			type: "investigado",
			actor_user_id: null,
		});
	});

	it("sin el agente de outreach habilitado no investiga", async () => {
		const store = createFakeStore();
		store.accounts.push({ ...vencida });
		store.tenants.delete(TENANT);
		const generate = vi.fn();

		const result = await researchAccount(
			{ tenantId: TENANT, userId: USER, domain: "acme.test", name: null },
			{ store, now, readPage, generate },
		);

		expect(result).toMatchObject({
			ok: false,
			reason: "outreach_no_habilitado",
		});
		expect(generate).not.toHaveBeenCalled();
	});

	it("una falla del modelo no se disfraza de rechazo: tira, para que un workflow reintente", async () => {
		const store = createFakeStore();
		store.accounts.push({ ...vencida });
		const generate = vi.fn(async () => {
			throw new Error("gateway caído");
		});

		await expect(
			researchAccount(
				{ tenantId: TENANT, userId: USER, domain: "acme.test", name: null },
				{ store, now, readPage, generate },
			),
		).rejects.toThrow("gateway caído");
	});
});
