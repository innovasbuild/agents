import { describe, expect, it } from "vitest";
import { revealContactEmail } from "@/lib/outreach/services/reveal-email";
import { createFakeStore, contactRow, TENANT } from "../fake-store";

function deps(store = createFakeStore(), email: string | null = "laura@acme.test") {
	return {
		store,
		leads: {
			searchOrganizations: async () => ({ organizations: [], hasMore: false, creditsUsed: 0 }),
			searchPeople: async () => ({ people: [], hasMore: false, creditsUsed: 0 }),
			revealEmail: async () => ({ email, creditsUsed: 1 }),
		},
	};
}

describe("revealContactEmail", () => {
	it("revela el email y promueve la clave a em:<email>", async () => {
		const store = createFakeStore();
		store.contacts.push({
			...contactRow(),
			id: "c1",
			contactKey: "li:laura-gomez",
			externalIds: { apollo: "p1" },
		} as never);

		const result = await revealContactEmail({ tenantId: TENANT, contactId: "c1" }, deps(store));

		expect(result).toMatchObject({ ok: true, email: "laura@acme.test", creditsUsed: 1 });
		expect(store.contacts[0].contactKey).toBe("em:laura@acme.test");
		expect(store.contacts[0].email).toBe("laura@acme.test");
	});

	it("Apollo sin email para esa persona: refusa sin gastar la clave", async () => {
		const store = createFakeStore();
		store.contacts.push({
			...contactRow(),
			id: "c1",
			contactKey: "li:laura-gomez",
			externalIds: { apollo: "p1" },
		} as never);

		const result = await revealContactEmail({ tenantId: TENANT, contactId: "c1" }, deps(store, null));

		expect(result).toMatchObject({ ok: false, reason: "sin_email" });
		expect(store.contacts[0].contactKey).not.toMatch(/^em:/);
	});

	it("la clave promovida ya existe: duplicado, no se fusiona", async () => {
		const store = createFakeStore();
		store.contacts.push(
			{ ...contactRow(), id: "existente", contactKey: "em:laura@acme.test" } as never,
			{ ...contactRow(), id: "c1", contactKey: "li:laura-gomez", externalIds: { apollo: "p1" } } as never,
		);

		const result = await revealContactEmail({ tenantId: TENANT, contactId: "c1" }, deps(store));

		expect(result).toMatchObject({ ok: false, reason: "duplicado" });
	});

	it("un contacto ya tocado (con evento o pieza) no promueve: la clave ya está congelada", async () => {
		const store = createFakeStore();
		store.contacts.push({ ...contactRow(), id: "c1", contactKey: "li:laura-gomez", externalIds: { apollo: "p1" } } as never);
		store.events.push({ tenantId: TENANT, contactKey: "li:laura-gomez", type: "encolado" } as never);

		const result = await revealContactEmail({ tenantId: TENANT, contactId: "c1" }, deps(store));

		expect(result).toMatchObject({ ok: false, reason: "contacto_ya_tocado" });
	});

	it("un contacto sin externalIds.apollo no se puede revelar", async () => {
		const store = createFakeStore();
		store.contacts.push({ ...contactRow(), id: "c1", externalIds: {} } as never);

		const result = await revealContactEmail({ tenantId: TENANT, contactId: "c1" }, deps(store));

		expect(result).toMatchObject({ ok: false, reason: "sin_origen_apollo" });
	});
});
