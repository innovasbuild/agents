import { describe, expect, it } from "vitest";
import { dayStart, localDate } from "@/lib/outreach/time";

describe("dayStart", () => {
	it("en Buenos Aires el día arranca a las 03:00 UTC", () => {
		expect(
			dayStart(
				"America/Argentina/Buenos_Aires",
				new Date("2026-09-15T12:00:00Z"),
			).toISOString(),
		).toBe("2026-09-15T03:00:00.000Z");
	});
	it("a las 23 hs de Buenos Aires todavía es el día anterior en UTC+0", () => {
		expect(
			dayStart(
				"America/Argentina/Buenos_Aires",
				new Date("2026-09-15T02:00:00Z"),
			).toISOString(),
		).toBe("2026-09-14T03:00:00.000Z");
	});
	it("en UTC es medianoche", () => {
		expect(
			dayStart("UTC", new Date("2026-09-15T12:34:56Z")).toISOString(),
		).toBe("2026-09-15T00:00:00.000Z");
	});
});

describe("localDate", () => {
	it("devuelve la fecha local del tenant", () => {
		expect(
			localDate(
				"America/Argentina/Buenos_Aires",
				new Date("2026-09-15T02:00:00Z"),
			),
		).toBe("2026-09-14");
	});
});
