import { describe, expect, it } from "vitest";
import {
	dayLabel,
	monthRange,
	originLabel,
	parsePeriod,
	platformTotals,
	summarize,
	toPlatformRows,
	toSpendRows,
	usd,
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

describe("platformTotals", () => {
	it("separa hoy, mes en curso y mes anterior por empresa, en UTC", () => {
		const rows = toPlatformRows([
			{ tenant_id: "a", day: "2026-10-13", amount: "1.5" },
			{ tenant_id: "a", day: "2026-10-02", amount: 2 },
			{ tenant_id: "a", day: "2026-09-30", amount: 4 },
			{ tenant_id: "b", day: "2026-09-10", amount: "0.25" },
			{ tenant_id: "b", day: "2026-08-31", amount: 100 },
		]);
		const totals = platformTotals(rows, new Date("2026-10-13T23:00:00Z"));
		expect(totals.get("a")).toEqual({ today: 1.5, month: 3.5, previous: 4 });
		expect(totals.get("b")).toEqual({ today: 0, month: 0, previous: 0.25 });
	});
});

describe("formato", () => {
	it("usd con dos decimales en es-AR", () => {
		expect(usd(1234.5)).toBe("US$ 1.234,50");
		expect(usd(0)).toBe("US$ 0,00");
	});

	it("dayLabel no corre el día por la zona horaria", () => {
		expect(dayLabel("2026-10-05")).toBe("05/10/2026");
	});
});
