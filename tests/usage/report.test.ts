import { describe, expect, it } from "vitest";
import {
	capitalizeFirst,
	dayLabel,
	monthRange,
	originLabel,
	parsePeriod,
	summarize,
	toPlatformRows,
	toSpendRows,
	usd,
	utcDayStart,
} from "@/lib/usage/report";

describe("parsePeriod", () => {
	it("solo acepta anterior; cualquier otra cosa es el mes en curso", () => {
		expect(parsePeriod("anterior")).toBe("anterior");
		expect(parsePeriod("actual")).toBe("actual");
		expect(parsePeriod(undefined)).toBe("actual");
		expect(parsePeriod(["anterior"])).toBe("actual");
	});
});

describe("monthRange", () => {
	const now = new Date("2026-10-13T15:00:00Z");

	it("mes en curso: del 1 al 1 del mes siguiente, en UTC", () => {
		const range = monthRange("actual", now);
		expect(range.from.toISOString()).toBe("2026-10-01T00:00:00.000Z");
		expect(range.to.toISOString()).toBe("2026-11-01T00:00:00.000Z");
		expect(range.label).toBe("octubre de 2026");
	});

	it("mes anterior", () => {
		const range = monthRange("anterior", now);
		expect(range.from.toISOString()).toBe("2026-09-01T00:00:00.000Z");
		expect(range.to.toISOString()).toBe("2026-10-01T00:00:00.000Z");
		expect(range.label).toBe("septiembre de 2026");
	});

	it("en enero, el mes anterior es diciembre del año anterior", () => {
		const range = monthRange("anterior", new Date("2027-01-15T12:00:00Z"));
		expect(range.from.toISOString()).toBe("2026-12-01T00:00:00.000Z");
		expect(range.to.toISOString()).toBe("2027-01-01T00:00:00.000Z");
		expect(range.label).toBe("diciembre de 2026");
	});

	it("corta en UTC aunque en Buenos Aires todavía sea el mes anterior", () => {
		// 2026-10-31 22:00 en Buenos Aires.
		const range = monthRange("actual", new Date("2026-11-01T01:00:00Z"));
		expect(range.label).toBe("noviembre de 2026");
	});
});

describe("toSpendRows y summarize", () => {
	const raw = [
		{ day: "2026-10-06", origin: "draft-queue", amount: "0.400000" },
		{ day: "2026-10-05", origin: "chat", amount: 0.1 },
		{ day: "2026-10-06", origin: "chat", amount: "0.200000" },
		{ day: "2026-10-06", origin: "sin_corrida", amount: 0.05 },
		{ day: 20261006, origin: "chat", amount: 1 },
		null,
	];

	it("descarta filas sin forma y convierte montos que llegan como texto", () => {
		expect(toSpendRows(raw)).toHaveLength(4);
		expect(toSpendRows(raw)[0]).toEqual({
			day: "2026-10-06",
			origin: "draft-queue",
			amount: 0.4,
		});
	});

	it("suma números: el total no concatena textos", () => {
		const summary = summarize(toSpendRows(raw));
		expect(summary.total).toBeCloseTo(0.75, 6);
	});

	it("por día, en orden de fecha", () => {
		const { byDay } = summarize(toSpendRows(raw));
		expect(byDay.map((row) => row.day)).toEqual(["2026-10-05", "2026-10-06"]);
		expect(byDay[1].amount).toBeCloseTo(0.65, 6);
	});

	it("por origen, de mayor a menor, con su rótulo", () => {
		const { byOrigin } = summarize(toSpendRows(raw));
		expect(byOrigin.map((row) => row.label)).toEqual([
			"draft-queue",
			"Chat",
			"Procesos programados",
		]);
		expect(byOrigin[1].amount).toBeCloseTo(0.3, 6);
	});

	it("sin filas, total cero y tablas vacías", () => {
		expect(summarize([])).toEqual({ total: 0, byDay: [], byOrigin: [] });
	});
});

describe("originLabel", () => {
	it("rotula chat y sin_corrida; un workflow muestra su clave", () => {
		expect(originLabel("chat")).toBe("Chat");
		expect(originLabel("sin_corrida")).toBe("Procesos programados");
		expect(originLabel("refresh-fichas")).toBe("refresh-fichas");
	});
});

describe("toPlatformRows", () => {
	it("una fila por empresa; el monto que llega como texto pasa a número", () => {
		const rows = toPlatformRows([
			{ tenant_id: "a", amount: "1.500000" },
			{ tenant_id: "b", amount: 2 },
			{ tenant_id: "c", amount: "no es un número" },
			{ tenant_id: 7, amount: 1 },
			null,
		]);
		expect(rows).toEqual([
			{ tenantId: "a", amount: 1.5 },
			{ tenantId: "b", amount: 2 },
			{ tenantId: "c", amount: 0 },
		]);
	});
});

describe("formato", () => {
	it("usd con dos decimales en es-AR", () => {
		expect(usd(1234.5)).toBe("US$ 1.234,50");
		expect(usd(0)).toBe("US$ 0,00");
	});

	it("capitalizeFirst sube solo la primera letra del mes", () => {
		expect(capitalizeFirst("octubre de 2026")).toBe("Octubre de 2026");
		expect(capitalizeFirst("")).toBe("");
	});

	it("dayLabel no corre el día por la zona horaria", () => {
		expect(dayLabel("2026-10-05")).toBe("05/10/2026");
	});

	it("utcDayStart es la medianoche UTC del día, sin importar la hora", () => {
		expect(utcDayStart(new Date("2026-10-13T15:30:00Z")).toISOString()).toBe(
			"2026-10-13T00:00:00.000Z",
		);
		// Casi fin de día en UTC: sigue siendo el mismo día.
		expect(
			utcDayStart(new Date("2026-10-13T23:59:59.999Z")).toISOString(),
		).toBe("2026-10-13T00:00:00.000Z");
		expect(utcDayStart(new Date("2026-10-13T00:00:00Z")).toISOString()).toBe(
			"2026-10-13T00:00:00.000Z",
		);
	});

	it("utcDayStart usa el día UTC aunque en Buenos Aires ya sea otro", () => {
		// 01:30 UTC del 14 es 22:30 del 13 en Buenos Aires (UTC-3).
		expect(utcDayStart(new Date("2026-10-14T01:30:00Z")).toISOString()).toBe(
			"2026-10-14T00:00:00.000Z",
		);
		// 23:30 UTC del 13 es 20:30 del 13 en Buenos Aires, pero 02:30 del 14 en UTC+3.
		expect(
			utcDayStart(new Date("2026-10-13T23:30:00-03:00")).toISOString(),
		).toBe("2026-10-14T00:00:00.000Z");
	});
});
