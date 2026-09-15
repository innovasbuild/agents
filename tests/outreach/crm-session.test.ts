import { describe, expect, it, vi } from "vitest";
import type { CrmAdapter } from "@/lib/connectors/crm/adapter";
import { HubSpotUnauthorizedError } from "@/lib/connectors/crm/hubspot";
import { withReauth } from "@/lib/outreach/crm-session";

function adapterThatFails(error: Error): CrmAdapter {
	const reject = async () => {
		throw error;
	};
	return {
		findContacts: reject,
		lastAuthorship: reject,
		upsertContact: reject,
		addNote: reject,
		completeOpenTasks: reject,
		createTask: reject,
	};
}

describe("withReauth", () => {
	it("un 401 de HubSpot pide reautorizar", async () => {
		const onUnauthorized = vi.fn(() => {
			throw new Error("auth requerida");
		}) as unknown as () => never;
		await expect(
			withReauth(
				adapterThatFails(new HubSpotUnauthorizedError()),
				onUnauthorized,
			).lastAuthorship("1"),
		).rejects.toThrow("auth requerida");
		expect(onUnauthorized).toHaveBeenCalledTimes(1);
	});
	it("otros errores pasan tal cual, sin pedir autorización", async () => {
		const onUnauthorized = vi.fn() as unknown as () => never;
		await expect(
			withReauth(adapterThatFails(new Error("500")), onUnauthorized).addNote(
				"1",
				{ body: "x", at: new Date(), ownerId: null },
			),
		).rejects.toThrow("500");
		expect(onUnauthorized).not.toHaveBeenCalled();
	});
});
