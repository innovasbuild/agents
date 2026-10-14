import { describe, expect, it, vi } from "vitest";
import { invitationOriginFrom } from "@/lib/domains/origin";
import type { DomainRow } from "@/lib/domains/service";

const row = (over: Partial<DomainRow>): DomainRow => ({
	id: "d1",
	tenantId: "t1",
	hostname: "ai.okeefe.com.ar",
	isPrimary: false,
	status: "active",
	lastError: null,
	verifiedAt: null,
	createdAt: "2026-10-14T00:00:00Z",
	...over,
});

const FALLBACK = "https://agentes.innov.as";
const storeOf = (rows: DomainRow[]) => ({ list: async () => rows });

describe("invitationOriginFrom", () => {
	it("usa el dominio principal activo de la empresa", async () => {
		const out = await invitationOriginFrom(
			storeOf([
				row({ hostname: "a.okeefe.com.ar" }),
				row({ id: "d2", hostname: "ai.okeefe.com.ar", isPrimary: true }),
			]),
			"t1",
			FALLBACK,
		);
		expect(out).toBe("https://ai.okeefe.com.ar");
	});

	it("sin principal usa el primer dominio activo", async () => {
		const out = await invitationOriginFrom(
			storeOf([row({ hostname: "a.okeefe.com.ar" })]),
			"t1",
			FALLBACK,
		);
		expect(out).toBe("https://a.okeefe.com.ar");
	});

	it("sin dominios, o con ninguno activo, cae al origen de siempre", async () => {
		expect(await invitationOriginFrom(storeOf([]), "t1", FALLBACK)).toBe(
			FALLBACK,
		);
		expect(
			await invitationOriginFrom(
				storeOf([row({ status: "verifying", isPrimary: true })]),
				"t1",
				FALLBACK,
			),
		).toBe(FALLBACK);
	});

	it("un .localhost no se usa: en desarrollo faltaría el puerto", async () => {
		expect(
			await invitationOriginFrom(
				storeOf([row({ hostname: "okeefe.localhost", isPrimary: true })]),
				"t1",
				"http://localhost:3000",
			),
		).toBe("http://localhost:3000");
	});

	it("si la base falla, la invitación sale igual con el origen de siempre", async () => {
		const error = vi.spyOn(console, "error").mockImplementation(() => {});
		const store = {
			list: async () => {
				throw new Error("caída");
			},
		};
		expect(await invitationOriginFrom(store, "t1", FALLBACK)).toBe(FALLBACK);
		error.mockRestore();
	});
});
