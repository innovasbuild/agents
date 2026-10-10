import { describe, expect, it } from "vitest";
import { READINESS_LABELS, tenantReadiness } from "@/lib/tenants/readiness";

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

	it("sin agentes habilitados", () => {
		expect(
			ok({ agents: [{ agent: "outreach", enabled: false }] }).missing,
		).toEqual(["agentes"]);
		expect(ok({ agents: [] }).missing).toEqual(["agentes"]);
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
