import { describe, expect, it } from "vitest";
import { decideBrainUpsertResponse } from "@/lib/brain/approval";

describe("decideBrainUpsertResponse", () => {
	it("acepta a un tenant_admin del mismo tenant", () => {
		expect(
			decideBrainUpsertResponse(
				{ attributes: { tenantId: "t1", role: "tenant_admin" } },
				"t1",
			),
		).toEqual({ status: "allowed" });
	});

	it("acepta a un platform_admin del mismo tenant", () => {
		expect(
			decideBrainUpsertResponse(
				{ attributes: { tenantId: "t1", role: "platform_admin" } },
				"t1",
			),
		).toEqual({ status: "allowed" });
	});

	it("rechaza a un tenant_member", () => {
		expect(
			decideBrainUpsertResponse(
				{ attributes: { tenantId: "t1", role: "tenant_member" } },
				"t1",
			),
		).toMatchObject({ status: "rejected" });
	});

	it("rechaza a un admin de otro tenant", () => {
		expect(
			decideBrainUpsertResponse(
				{ attributes: { tenantId: "t2", role: "tenant_admin" } },
				"t1",
			),
		).toMatchObject({ status: "rejected" });
	});

	it("rechaza sin atributos", () => {
		expect(decideBrainUpsertResponse(null, "t1")).toMatchObject({
			status: "rejected",
		});
		expect(decideBrainUpsertResponse({}, "t1")).toMatchObject({
			status: "rejected",
		});
	});
});
