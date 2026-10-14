import { describe, expect, it } from "vitest";
import {
	agentsNeedCanon,
	canonState,
	READINESS_LABELS,
	tenantReadiness,
} from "@/lib/tenants/readiness";

const ok = (over: Partial<Parameters<typeof tenantReadiness>[0]> = {}) =>
	tenantReadiness({
		agents: [{ agent: "outreach", enabled: true }],
		connections: [
			{
				capability: "brain",
				provider: "wiki",
				enabled: true,
				verifiedAt: null,
			},
			{
				capability: "crm",
				provider: "hubspot",
				enabled: true,
				verifiedAt: null,
			},
			{
				capability: "leads",
				provider: "coldiq",
				enabled: true,
				verifiedAt: "2026-10-10T00:00:00Z",
			},
			{
				capability: "mail",
				provider: "gmail",
				enabled: true,
				verifiedAt: null,
			},
		],
		...over,
	});

describe("tenantReadiness", () => {
	it("con todo lo que el agente necesita, está lista", () => {
		expect(ok()).toEqual({ ready: true, missing: [] });
	});

	it("sin agentes y con brain, está lista", () => {
		expect(
			tenantReadiness({
				agents: [],
				connections: [
					{
						capability: "brain",
						provider: "wiki",
						enabled: true,
						verifiedAt: null,
					},
				],
			}),
		).toEqual({ ready: true, missing: [] });
	});

	it("un agente deshabilitado y brain, está lista", () => {
		expect(
			tenantReadiness({
				agents: [{ agent: "outreach", enabled: false }],
				connections: [
					{
						capability: "brain",
						provider: "wiki",
						enabled: true,
						verifiedAt: null,
					},
				],
			}),
		).toEqual({ ready: true, missing: [] });
	});

	it("sin agentes y sin brain, faltan los dos", () => {
		expect(tenantReadiness({ agents: [], connections: [] }).missing).toEqual([
			"agentes",
			"brain",
		]);
	});

	it("sin brain habilitado", () => {
		const r = ok({
			connections: [
				{
					capability: "brain",
					provider: "wiki",
					enabled: false,
					verifiedAt: null,
				},
				{
					capability: "crm",
					provider: "hubspot",
					enabled: true,
					verifiedAt: null,
				},
				{
					capability: "leads",
					provider: "coldiq",
					enabled: true,
					verifiedAt: "x",
				},
				{
					capability: "mail",
					provider: "gmail",
					enabled: true,
					verifiedAt: null,
				},
			],
		});
		expect(r.missing).toEqual(["brain"]);
	});

	it("un agente habilitado que necesita una capacidad sin conector", () => {
		const r = ok({
			connections: [
				{
					capability: "brain",
					provider: "wiki",
					enabled: true,
					verifiedAt: null,
				},
				{
					capability: "leads",
					provider: "coldiq",
					enabled: true,
					verifiedAt: "x",
				},
				{
					capability: "mail",
					provider: "gmail",
					enabled: true,
					verifiedAt: null,
				},
			],
		});
		expect(r.missing).toEqual(["conectores"]);
	});

	it("un conector con llave que no está verificado", () => {
		const r = ok({
			connections: [
				{
					capability: "brain",
					provider: "wiki",
					enabled: true,
					verifiedAt: null,
				},
				{
					capability: "crm",
					provider: "hubspot",
					enabled: true,
					verifiedAt: null,
				},
				{
					capability: "leads",
					provider: "coldiq",
					enabled: true,
					verifiedAt: null,
				},
				{
					capability: "mail",
					provider: "gmail",
					enabled: true,
					verifiedAt: null,
				},
			],
		});
		expect(r.missing).toEqual(["verificacion"]);
	});

	it("los proveedores sin llave (hubspot, gmail, wiki) nunca piden verificación", () => {
		expect(ok().missing).toEqual([]);
	});

	it("un agente fuera del catálogo no exige nada", () => {
		expect(
			ok({
				agents: [
					{ agent: "outreach", enabled: true },
					{ agent: "raro", enabled: true },
				],
			}).missing,
		).toEqual([]);
	});

	it("las causas vienen en orden fijo y cada una tiene rótulo", () => {
		const r = tenantReadiness({ agents: [], connections: [] });
		expect(r).toEqual({ ready: false, missing: ["agentes", "brain"] });
		for (const issue of r.missing) expect(READINESS_LABELS[issue]).toBeTruthy();
	});

	it("un brain mcp (llave de conexión) sin verificar no cuenta como sin verificar", () => {
		const r = ok({
			connections: [
				{
					capability: "brain",
					provider: "mcp",
					enabled: true,
					verifiedAt: null,
				},
				{
					capability: "crm",
					provider: "hubspot",
					enabled: true,
					verifiedAt: null,
				},
				{
					capability: "leads",
					provider: "coldiq",
					enabled: true,
					verifiedAt: "x",
				},
				{
					capability: "mail",
					provider: "gmail",
					enabled: true,
					verifiedAt: null,
				},
			],
		});
		expect(r).toEqual({ ready: true, missing: [] });
	});
});

describe("ICP y marco en el brain", () => {
	it("con los dos bien, no falta nada", () => {
		expect(ok({ canon: { icp: "ok", marco: "ok" } })).toEqual({
			ready: true,
			missing: [],
		});
	});

	it("ICP faltante o inválido: falta el ICP", () => {
		expect(ok({ canon: { icp: "falta", marco: "ok" } }).missing).toEqual([
			"icp",
		]);
		expect(ok({ canon: { icp: "invalido", marco: "ok" } }).missing).toEqual([
			"icp",
		]);
	});

	it("marco faltante: faltan hooks y vectores", () => {
		expect(ok({ canon: { icp: "ok", marco: "falta" } }).missing).toEqual([
			"marco",
		]);
		expect(READINESS_LABELS.marco).toBe("faltan hooks y vectores en el brain");
		expect(READINESS_LABELS.icp).toBe("falta el ICP en el brain");
	});

	it("un brain que no se pudo leer no suma motivo", () => {
		expect(
			ok({ canon: { icp: "sin_leer", marco: "sin_leer" } }).missing,
		).toEqual([]);
	});

	it("sin outreach habilitado no se pide ICP ni marco", () => {
		expect(
			ok({
				agents: [{ agent: "outreach", enabled: false }],
				canon: { icp: "falta", marco: "falta" },
			}).missing,
		).toEqual([]);
	});

	it("sin canon en la entrada (el listado) no cambia nada", () => {
		expect(ok().missing).toEqual([]);
	});

	it("canonState traduce la carga", () => {
		expect(canonState({ ok: true })).toBe("ok");
		expect(canonState({ ok: false, reason: "falta" })).toBe("falta");
		expect(canonState({ ok: false, reason: "invalido" })).toBe("invalido");
		expect(canonState({ ok: false, reason: "brain_caido" })).toBe("sin_leer");
		expect(canonState({ ok: false, reason: "sin_brain" })).toBe("sin_leer");
	});
});

describe("agentsNeedCanon", () => {
	it("el asistente solo no pide canon", () => {
		expect(agentsNeedCanon([{ agent: "asistente" }])).toBe(false);
	});

	it("con outreach sí", () => {
		expect(
			agentsNeedCanon([{ agent: "asistente" }, { agent: "outreach" }]),
		).toBe(true);
	});
});

it("solo con el asistente y brain, la empresa está lista", () => {
	expect(
		tenantReadiness({
			agents: [{ agent: "asistente", enabled: true }],
			connections: [
				{
					capability: "brain",
					provider: "wiki",
					enabled: true,
					verifiedAt: null,
				},
			],
		}),
	).toEqual({ ready: true, missing: [] });
});
