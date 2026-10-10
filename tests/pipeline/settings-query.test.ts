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
			displayName: null,
			title: null,
			linkedinUrl: null,
			crmOwnerId: null,
		});
	});

	it("un ejecutor sin slug ni autorización no revienta", () => {
		const [row] = toExecutorRows([
			{ user_id: "u1", slug: null, daily_quota: 30, gmail_authorized_at: null },
		]);

		expect(row.slug).toBeNull();
		expect(row.gmailAuthorizedAt).toBeNull();
	});

	it("trae la firma y el dueño en el CRM del ejecutor", () => {
		expect(
			toExecutorRows([
				{
					user_id: "u1",
					slug: "ana",
					daily_quota: 30,
					gmail_authorized_at: null,
					display_name: "Ana López",
					title: "AE",
					linkedin_url: "https://www.linkedin.com/in/ana",
					crm_owner_id: "777",
				},
			])[0],
		).toMatchObject({
			displayName: "Ana López",
			title: "AE",
			linkedinUrl: "https://www.linkedin.com/in/ana",
			crmOwnerId: "777",
		});
	});

	it("un ejecutor sin esos datos los trae en null", () => {
		expect(toExecutorRows([{ user_id: "u1" }])[0]).toMatchObject({
			displayName: null,
			title: null,
			linkedinUrl: null,
			crmOwnerId: null,
		});
	});
});

describe("toConnectionRows", () => {
	it("la conexión dice si la bloqueó plataforma", () => {
		const rows = toConnectionRows([
			{
				id: "c1",
				capability: "leads",
				provider: "coldiq",
				enabled: false,
				locked_by_platform: true,
			},
			{ id: "c2", capability: "crm", provider: "hubspot", enabled: true },
		]);
		expect(rows.map((row) => row.lockedByPlatform)).toEqual([true, false]);
	});
	it("aplana los campos de la conexión", () => {
		const [row] = toConnectionRows([
			{ id: "c1", capability: "mail", provider: "gmail", enabled: true },
		]);

		expect(row).toEqual({
			id: "c1",
			capability: "mail",
			provider: "gmail",
			enabled: true,
			lockedByPlatform: false,
		});
	});

	it("un enabled que no llega como booleano cae en false, nunca en truthy por accidente", () => {
		const [row] = toConnectionRows([
			{ id: "c1", capability: "mail", provider: "gmail", enabled: null },
		]);

		expect(row.enabled).toBe(false);
	});
});
