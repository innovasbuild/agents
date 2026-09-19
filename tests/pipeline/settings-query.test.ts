import { describe, expect, it } from "vitest";
import {
	toConnectionRows,
	toExecutorRows,
} from "@/lib/outreach/settings-query";

describe("toExecutorRows", () => {
	it("aplana los campos del ejecutor", () => {
		const [row] = toExecutorRows([
			{
				user_id: "u1",
				slug: "mati",
				daily_quota: 30,
				gmail_authorized_at: "2026-09-01T00:00:00Z",
			},
		]);

		expect(row).toEqual({
			userId: "u1",
			slug: "mati",
			dailyQuota: 30,
			gmailAuthorizedAt: "2026-09-01T00:00:00Z",
		});
	});

	it("un ejecutor sin slug ni autorización no revienta", () => {
		const [row] = toExecutorRows([
			{ user_id: "u1", slug: null, daily_quota: 30, gmail_authorized_at: null },
		]);

		expect(row.slug).toBeNull();
		expect(row.gmailAuthorizedAt).toBeNull();
	});
});

describe("toConnectionRows", () => {
	it("aplana los campos de la conexión", () => {
		const [row] = toConnectionRows([
			{ id: "c1", capability: "mail", provider: "gmail", enabled: true },
		]);

		expect(row).toEqual({
			id: "c1",
			capability: "mail",
			provider: "gmail",
			enabled: true,
		});
	});

	it("un enabled que no llega como booleano cae en false, nunca en truthy por accidente", () => {
		const [row] = toConnectionRows([
			{ id: "c1", capability: "mail", provider: "gmail", enabled: null },
		]);

		expect(row.enabled).toBe(false);
	});
});
