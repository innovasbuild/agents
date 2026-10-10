import { describe, expect, it, vi } from "vitest";
import {
	ACCOUNT_LABELS,
	accountsFor,
	probeAccount,
	STATE_LABELS,
} from "@/lib/accounts/status";

const HUBSPOT = { capability: "crm", provider: "hubspot", enabled: true };
const GMAIL = { capability: "mail", provider: "gmail", enabled: true };

describe("accountsFor", () => {
	it("HubSpot para cualquiera si la empresa lo tiene habilitado", () => {
		expect(accountsFor({ connections: [HUBSPOT], isExecutor: false })).toEqual([
			"hubspot",
		]);
	});

	it("Gmail solo para ejecutores, y solo si la empresa lo tiene habilitado", () => {
		expect(
			accountsFor({ connections: [HUBSPOT, GMAIL], isExecutor: true }),
		).toEqual(["hubspot", "gmail"]);
		expect(
			accountsFor({ connections: [HUBSPOT, GMAIL], isExecutor: false }),
		).toEqual(["hubspot"]);
		expect(accountsFor({ connections: [HUBSPOT], isExecutor: true })).toEqual([
			"hubspot",
		]);
	});

	it("un conector deshabilitado no cuenta", () => {
		expect(
			accountsFor({
				connections: [
					{ ...HUBSPOT, enabled: false },
					{ ...GMAIL, enabled: false },
				],
				isExecutor: true,
			}),
		).toEqual([]);
	});

	it("otros proveedores no generan cuentas", () => {
		expect(
			accountsFor({
				connections: [
					{ capability: "leads", provider: "coldiq", enabled: true },
					{ capability: "crm", provider: "otro", enabled: true },
				],
				isExecutor: true,
			}),
		).toEqual([]);
	});
});

describe("probeAccount", () => {
	const AUTH = new Error("auth");
	const MISSING = new Error("not installed");
	const deps = (token: () => Promise<unknown>) => ({
		token,
		isAuthError: (e: unknown) => e === AUTH,
		isNotInstalled: (e: unknown) => e === MISSING,
	});

	it("hay token: autorizada", async () => {
		expect(
			await probeAccount(
				"gmail",
				deps(async () => ({ token: "t" })),
			),
		).toBe("autorizada");
	});

	it("falta el grant: sin autorizar", async () => {
		expect(
			await probeAccount(
				"gmail",
				deps(async () => {
					throw AUTH;
				}),
			),
		).toBe("sin_autorizar");
	});

	it("el conector no está instalado: no disponible", async () => {
		expect(
			await probeAccount(
				"hubspot",
				deps(async () => {
					throw MISSING;
				}),
			),
		).toBe("no_disponible");
	});

	it("cualquier otro error es desconocido, nunca sin autorizar, y se registra", async () => {
		const log = vi.spyOn(console, "error").mockImplementation(() => {});
		try {
			expect(
				await probeAccount(
					"gmail",
					deps(async () => {
						throw new Error("red caída");
					}),
				),
			).toBe("desconocido");
			expect(log).toHaveBeenCalled();
		} finally {
			log.mockRestore();
		}
	});

	it("no instalado gana si un error cumple las dos condiciones", async () => {
		const both = new Error("ambos");
		expect(
			await probeAccount("hubspot", {
				token: async () => {
					throw both;
				},
				isAuthError: () => true,
				isNotInstalled: () => true,
			}),
		).toBe("no_disponible");
	});

	it("le pide el token a la cuenta que le pasaron", async () => {
		const token = vi.fn(async () => "t");
		await probeAccount("hubspot", {
			token,
			isAuthError: () => false,
			isNotInstalled: () => false,
		});
		expect(token).toHaveBeenCalledWith("hubspot");
	});
});

describe("rótulos", () => {
	it("cada cuenta y cada estado tienen texto", () => {
		expect(ACCOUNT_LABELS).toEqual({ hubspot: "HubSpot", gmail: "Gmail" });
		expect(STATE_LABELS.no_disponible).toBe(
			"No disponible: pedile a INNOV.AS que la habilite",
		);
		expect(STATE_LABELS.desconocido).toBe(
			"No pude comprobarlo. Recargá la página.",
		);
		expect(STATE_LABELS.autorizada).toBe("Autorizada");
		expect(STATE_LABELS.sin_autorizar).toBe("Sin autorizar");
	});
});
