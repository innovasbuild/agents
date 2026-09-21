import { describe, expect, it, vi } from "vitest";
import type { LeadsAdapter } from "@/lib/connectors/leads/adapter";
import { searchTargetsPage } from "@/lib/outreach/services/target-search";
import { createFakeStore, TENANT, USER } from "../fake-store";

const focus = {
	id: "f1",
	tenantId: TENANT,
	createdBy: USER,
	name: "Envases GBA",
	criteria: { employeeRanges: ["50,200"], locations: [], keywords: [], titles: [] },
	vector: "v1",
	segment: "mid_market_ar",
	hook: "h1",
	idioma: "es_ar",
	maxAccounts: 10,
	maxContacts: 20,
	status: "activo" as const,
	accountsFound: 0,
	contactsFound: 0,
};

const ORG = {
	externalId: "org1",
	name: "Acme",
	domain: "acme.test",
	linkedinUrl: null,
	employees: 120,
	industry: "packaging",
	location: "Rosario, Argentina",
	foundedYear: 1998,
};

const PERSON = {
	externalId: "p1",
	name: "Laura Gómez",
	title: "Gerente General",
	linkedinSlug: "laura-gomez",
	organizationExternalId: "org1",
};

function adapter(overrides: Partial<LeadsAdapter> = {}): LeadsAdapter {
	return {
		searchOrganizations: async () => ({
			organizations: [ORG],
			hasMore: false,
			creditsUsed: 1,
		}),
		searchPeople: async () => ({
			people: [PERSON],
			hasMore: false,
			creditsUsed: 1,
		}),
		revealEmail: async () => ({ email: null, creditsUsed: 1 }),
		...overrides,
	};
}

const deps = (store = createFakeStore(), leads = adapter()) => ({
	store,
	leads,
	crm: null,
	now: () => new Date("2026-09-22T12:00:00Z"),
});

describe("searchTargetsPage", () => {
	it("crea la cuenta y el contacto con la atribución del foco", async () => {
		const store = createFakeStore();
		const result = await searchTargetsPage({ focus, page: 1 }, deps(store));

		expect(result).toMatchObject({ ok: true, accounts: 1 });
		const contact = store.contacts[0];
		expect(contact).toMatchObject({
			contactKey: "li:laura-gomez",
			title: "Gerente General",
			vector: "v1",
			segment: "mid_market_ar",
			hook: "h1",
			idioma: "es_ar",
			ownerUserId: USER,
			source: "apollo",
		});
		expect(contact.email).toBeNull();
	});

	it("una empresa sin dominio se descarta y no se busca gente adentro", async () => {
		const searchPeople = vi.fn(async () => ({
			people: [],
			hasMore: false,
			creditsUsed: 1,
		}));
		const store = createFakeStore();
		const result = await searchTargetsPage(
			{ focus, page: 1 },
			deps(
				store,
				adapter({
					searchOrganizations: async () => ({
						organizations: [{ ...ORG, domain: null }],
						hasMore: false,
						creditsUsed: 1,
					}),
					searchPeople,
				}),
			),
		);

		expect(result).toMatchObject({ ok: true, accounts: 0 });
		expect((result as { discarded: Record<string, number> }).discarded).toMatchObject({
			sin_dominio: 1,
		});
		expect(searchPeople).not.toHaveBeenCalled();
	});

	it("una persona ya trabajada por otro ejecutor se saltea con claim_ajeno", async () => {
		const store = createFakeStore();
		store.contacts.push({
			...store.contactSeed(),
			contactKey: "li:laura-gomez",
			ownerUserId: "otro-ejecutor",
		});

		const result = await searchTargetsPage({ focus, page: 1 }, deps(store));

		expect((result as { discarded: Record<string, number> }).discarded).toMatchObject({
			claim_ajeno: 1,
		});
		expect(store.contacts).toHaveLength(1);
	});

	it("respeta el tope de contactos del foco", async () => {
		const store = createFakeStore();
		const people = Array.from({ length: 5 }, (_, i) => ({
			...PERSON,
			externalId: `p${i}`,
			linkedinSlug: `persona-${i}`,
		}));

		const result = await searchTargetsPage(
			{ focus: { ...focus, maxContacts: 3, contactsFound: 1 }, page: 1 },
			deps(store, adapter({
				searchPeople: async () => ({ people, hasMore: false, creditsUsed: 1 }),
			})),
		);

		// Quedaban 2 de cupo: entran 2, no 5.
		expect((result as { contactIds: string[] }).contactIds).toHaveLength(2);
	});

	it("suma los créditos de las dos llamadas", async () => {
		const result = await searchTargetsPage({ focus, page: 1 }, deps());
		expect((result as { creditsUsed: number }).creditsUsed).toBe(2);
	});

	it("una persona sin slug ni nombre utilizable se descarta, no rompe la página", async () => {
		const store = createFakeStore();
		const result = await searchTargetsPage(
			{ focus, page: 1 },
			deps(
				store,
				adapter({
					searchPeople: async () => ({
						people: [{ ...PERSON, name: "", linkedinSlug: null }],
						hasMore: false,
						creditsUsed: 1,
					}),
				}),
			),
		);
		expect((result as { discarded: Record<string, number> }).discarded).toMatchObject({
			sin_clave: 1,
		});
	});
});
