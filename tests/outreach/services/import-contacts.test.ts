import { describe, expect, it } from "vitest";
import { importContacts } from "@/lib/outreach/services/import-contacts";
import {
	contactRow,
	createFakeStore,
	fakeCrm,
	OTHER_USER,
	TENANT,
	USER,
} from "../fake-store";

const caller = {
	tenantId: TENANT,
	userId: USER,
	role: "tenant_member",
	email: "ana@innov.test",
};
const now = () => new Date("2026-09-15T12:00:00Z");

const CSV = [
	"name,email,company,segment,vector",
	"Laura Gómez,Laura@Acme.test,Acme,mid_market_ar,v1",
	"Sin Mail,,Acme,,",
	"Repetida,laura@acme.test,Acme,,",
	"Beto,beto@fabrica.test,Fabrica,no_existe,",
].join("\n");

describe("importContacts", () => {
	it("un usuario que no es ejecutor no carga", async () => {
		const store = createFakeStore();
		store.executors = [];
		expect(
			await importContacts({ csv: CSV, caller }, { store, crm: null, now }),
		).toMatchObject({ ok: false, reason: "no_ejecutor" });
	});

	it("con CRM y sin crm_owner_id no carga (bloquearía sus propios follow-ups)", async () => {
		const store = createFakeStore();
		expect(
			await importContacts(
				{ csv: CSV, caller },
				{ store, crm: fakeCrm(), now },
			),
		).toMatchObject({ ok: false, reason: "ejecutor_sin_crm_owner" });
	});

	it("veredicto por fila, inserta solo las nuevas y registra eventos", async () => {
		const store = createFakeStore();
		const result = await importContacts(
			{ csv: CSV, caller },
			{ store, crm: null, now },
		);
		if (!result.ok) throw new Error(result.message);
		expect(result.rows.map((r) => [r.line, r.verdict])).toEqual([
			[2, "nuevo"],
			[3, "sin_email"],
			[4, "invalida"],
			[5, "invalida"],
		]);
		expect(store.contacts.map((c) => c.contactKey)).toEqual([
			"em:laura@acme.test",
		]);
		expect(store.contacts[0]).toMatchObject({
			segment: "mid_market_ar",
			vector: "v1",
			source: "csv",
			ownerUserId: null,
		});
		expect(store.events.map((e) => e.type)).toEqual(["contacto_importado"]);
	});

	it("un contacto que ya existe con otro dueño es claim_ajeno; libre o propio es ya_existia", async () => {
		const store = createFakeStore();
		store.contacts.push(
			contactRow({ contactKey: "em:laura@acme.test", ownerUserId: OTHER_USER }),
		);
		store.contacts.push(
			contactRow({
				contactKey: "em:beto@fabrica.test",
				email: "beto@fabrica.test",
				ownerUserId: null,
			}),
		);
		const result = await importContacts(
			{
				csv: "name,email\nLaura,laura@acme.test\nBeto,beto@fabrica.test",
				caller,
			},
			{ store, crm: null, now },
		);
		if (!result.ok) throw new Error(result.message);
		expect(result.rows.map((r) => r.verdict)).toEqual([
			"claim_ajeno",
			"ya_existia",
		]);
		expect(store.events.map((e) => e.type)).toEqual(["claim_ajeno"]);
	});

	it("un contacto ya cargado con dueño ajeno en la base, pero con autoría reciente del owner del ejecutor en el CRM, es ya_existia", async () => {
		const store = createFakeStore();
		store.executors[0].crmOwnerId = "owner-ana";
		store.contacts.push(
			contactRow({
				contactKey: "em:laura@acme.test",
				ownerUserId: OTHER_USER,
				crmId: "crm-9",
			}),
		);
		let authorshipCalls = 0;
		const crm = fakeCrm({
			lastAuthorship: async () => {
				authorshipCalls++;
				return { ownerId: "owner-ana", at: new Date("2026-09-10T00:00:00Z") };
			},
		});
		const result = await importContacts(
			{ csv: "name,email\nLaura,laura@acme.test", caller },
			{ store, crm, now },
		);
		if (!result.ok) throw new Error(result.message);
		expect(result.rows[0].verdict).toBe("ya_existia");
		expect(store.events).toEqual([]);
		// Con crm_id guardado alcanza una consulta de autoría por contacto conocido.
		expect(authorshipCalls).toBe(1);
	});

	it("un contacto ya cargado con autoría reciente ajena en el CRM sigue siendo claim_ajeno", async () => {
		const store = createFakeStore();
		store.executors[0].crmOwnerId = "owner-ana";
		store.contacts.push(
			contactRow({ contactKey: "em:laura@acme.test", crmId: "crm-9" }),
		);
		const crm = fakeCrm({
			lastAuthorship: async () => ({
				ownerId: "owner-beto",
				at: new Date("2026-09-10T00:00:00Z"),
			}),
		});
		const result = await importContacts(
			{ csv: "name,email\nLaura,laura@acme.test", caller },
			{ store, crm, now },
		);
		if (!result.ok) throw new Error(result.message);
		expect(result.rows[0].verdict).toBe("claim_ajeno");
		expect(store.events.map((e) => e.type)).toEqual(["claim_ajeno"]);
	});

	it("autoría reciente de otro owner en el CRM es claim_ajeno aunque la base no lo conozca", async () => {
		const store = createFakeStore();
		store.executors[0].crmOwnerId = "owner-ana";
		const crm = fakeCrm({
			findContacts: async () => [
				{
					id: "crm-9",
					contactKey: null,
					email: "laura@acme.test",
					linkedinSlugs: [],
					ownerId: "owner-beto",
				},
			],
			lastAuthorship: async () => ({
				ownerId: "owner-beto",
				at: new Date("2026-09-01T00:00:00Z"),
			}),
		});
		const result = await importContacts(
			{ csv: "name,email\nLaura,laura@acme.test", caller },
			{ store, crm, now },
		);
		if (!result.ok) throw new Error(result.message);
		expect(result.rows[0].verdict).toBe("claim_ajeno");
		expect(store.contacts).toHaveLength(0);
	});

	it("un match en el CRM sin autoría ajena se inserta con su crm_id", async () => {
		const store = createFakeStore();
		store.executors[0].crmOwnerId = "owner-ana";
		const crm = fakeCrm({
			findContacts: async () => [
				{
					id: "crm-9",
					contactKey: null,
					email: "laura@acme.test",
					linkedinSlugs: [],
					ownerId: null,
				},
			],
		});
		await importContacts(
			{ csv: "name,email\nLaura,laura@acme.test", caller },
			{ store, crm, now },
		);
		expect(store.contacts[0].crmId).toBe("crm-9");
	});

	it("si el CRM falla en la segunda fila, la primera queda con su contacto y su evento", async () => {
		const store = createFakeStore();
		store.executors[0].crmOwnerId = "owner-ana";
		let calls = 0;
		const crm = fakeCrm({
			findContacts: async () => {
				calls++;
				if (calls === 2) throw new Error("HubSpot no responde");
				return [];
			},
		});
		await expect(
			importContacts(
				{
					csv: "name,email\nLaura,laura@acme.test\nBeto,beto@fabrica.test",
					caller,
				},
				{ store, crm, now },
			),
		).rejects.toThrow("HubSpot no responde");
		expect(store.contacts.map((c) => c.contactKey)).toEqual([
			"em:laura@acme.test",
		]);
		expect(store.events).toEqual([
			expect.objectContaining({
				type: "contacto_importado",
				tenant_id: TENANT,
				contact_key: "em:laura@acme.test",
			}),
		]);
	});

	it("un CSV que no parsea devuelve sus errores sin cargar nada", async () => {
		const store = createFakeStore();
		const result = await importContacts(
			{ csv: "name;email\nLaura;laura@acme.test", caller },
			{ store, crm: null, now },
		);
		if (!result.ok) throw new Error(result.message);
		expect(result.rows).toEqual([]);
		expect(result.errors[0].reason).toContain("separador");
	});
});
