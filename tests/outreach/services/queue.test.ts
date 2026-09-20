import { describe, expect, it, vi } from "vitest";
import type { CrmAdapter } from "@/lib/connectors/crm/adapter";
import type { Canon } from "@/lib/outreach/canon";
import { emptyGateRules } from "@/lib/outreach/gate-blocks";
import {
	listQueue,
	queueTouch,
	rejectQueueItem,
	updateQueueItem,
} from "@/lib/outreach/services/queue";
import {
	contactRow,
	createFakeStore,
	fakeCrm,
	OTHER_USER,
	PASSING_BODY,
	TENANT,
	USER,
} from "../fake-store";

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({}) }));

const caller = {
	tenantId: TENANT,
	userId: USER,
	role: "tenant_member",
	email: "ana@innov.test",
};
const now = () => new Date("2026-09-15T12:00:00Z");
const canon: Canon = {
	available: true,
	pages: [
		{
			tag: "canon:icp",
			slug: "comercial/icp",
			title: "ICP",
			body: "A quién le servimos.",
		},
	],
	voice: [],
	rules: emptyGateRules(),
};
// Sin binding de brain, o con brain sin páginas de canon: no se encola.
const CANON_VACIO: Canon = {
	available: false,
	pages: [],
	voice: [],
	rules: emptyGateRules(),
};
const touch = {
	caller,
	contactKey: "em:laura@acme.test",
	kind: "msg1" as const,
	subject: "Crecer sin sumar gente",
	body: PASSING_BODY,
	hook: "h1",
	vector: "v1",
	idioma: "es_ar",
	ancla: { hecho: "Abrió planta", fuente: "https://acme.test/n" },
};

function accountRow() {
	return {
		id: "a1",
		tenantId: TENANT,
		domain: "acme.test",
		name: "Acme",
		ficha: {
			name: "Acme",
			domain: "acme.test",
			produce: null,
			gana: null,
			compra: null,
			rompe_si_crece: null,
			gap_declarado: null,
			gap_demostrable: null,
			hechos: [
				{ hecho: "Abrió planta", url: "https://acme.test/n", fecha: null },
			],
			creditos_usados: 0,
		},
		researchedAt: "2026-09-01T00:00:00Z",
		expiresAt: "2026-11-30T00:00:00Z",
	};
}

function setup() {
	const store = createFakeStore();
	store.contacts.push(contactRow());
	store.accounts.push(accountRow());
	return {
		store,
		deps: {
			store,
			crm: null as CrmAdapter | null,
			loadCanon: async () => canon,
			now,
		},
	};
}

describe("queueTouch", () => {
	it("encola una pieza pending, reserva el claim y registra el evento", async () => {
		const { store, deps } = setup();
		const result = await queueTouch(touch, deps);
		expect(result).toMatchObject({ ok: true });
		expect(store.queue[0]).toMatchObject({
			status: "pending",
			executorUserId: USER,
			toEmail: "laura@acme.test",
			draftOriginal: { subject: touch.subject, body: PASSING_BODY },
			gateResult: { status: "ok" },
		});
		expect(store.contacts[0]).toMatchObject({
			ownerUserId: USER,
			hook: "h1",
			vector: "v1",
			idioma: "es_ar",
		});
		expect(store.events.map((e) => e.type)).toEqual(["encolado"]);
	});

	it("vuelve a correr el gate: un borrador que no pasa no se encola", async () => {
		const { store, deps } = setup();
		expect(
			await queueTouch(
				{ ...touch, body: `${PASSING_BODY}\nQuedo a disposición.` },
				deps,
			),
		).toMatchObject({ ok: false, reason: "gate" });
		expect(store.queue).toHaveLength(0);
		expect(store.events.map((e) => e.type)).toEqual(["gate_fallido"]);
	});

	it("claim ajeno (base o CRM) no encola", async () => {
		const { store, deps } = setup();
		store.contacts[0].ownerUserId = OTHER_USER;
		expect(await queueTouch(touch, deps)).toMatchObject({
			ok: false,
			reason: "claim_ajeno",
		});
		store.contacts[0].ownerUserId = null;
		store.executors[0].crmOwnerId = "owner-ana";
		const crm = fakeCrm({
			findContacts: async () => [
				{
					id: "crm-1",
					contactKey: "em:laura@acme.test",
					email: "laura@acme.test",
					linkedinSlugs: [],
					ownerId: null,
				},
			],
			lastAuthorship: async () => ({
				ownerId: "owner-beto",
				at: new Date("2026-09-10T00:00:00Z"),
			}),
		});
		expect(await queueTouch(touch, { ...deps, crm })).toMatchObject({
			ok: false,
			reason: "claim_ajeno",
		});
		expect(store.queue).toHaveLength(0);
	});

	it("un canon vacío (tenant sin brain o sin canon cargado) no encola", async () => {
		const { store, deps } = setup();
		expect(
			await queueTouch(touch, { ...deps, loadCanon: async () => CANON_VACIO }),
		).toMatchObject({
			ok: false,
			reason: "canon_no_disponible",
			message: expect.stringContaining("no está conectado"),
		});
		expect(store.queue).toHaveLength(0);
	});

	it("una sola pieza viva por persona, etapa compatible y atribución válida", async () => {
		const { store, deps } = setup();
		await queueTouch(touch, deps);
		store.contacts[0].ownerUserId = null;
		expect(await queueTouch(touch, deps)).toMatchObject({
			ok: false,
			reason: "pieza_viva",
		});
		expect(await queueTouch({ ...touch, hook: "h_x" }, deps)).toMatchObject({
			ok: false,
			reason: "atribucion_invalida",
		});
		store.contacts[0].stage = "msg1_enviado";
		expect(await queueTouch(touch, deps)).toMatchObject({
			ok: false,
			reason: "etapa_incompatible",
		});
	});

	it("sin ficha vigente de la cuenta no encola: sin_ancla", async () => {
		const { store, deps } = setup();
		store.accounts = [];
		expect(await queueTouch(touch, deps)).toMatchObject({
			ok: false,
			reason: "sin_ancla",
		});
		expect(store.queue).toHaveLength(0);
		expect(store.events).toHaveLength(0);
	});

	it("una fuente que no está en la ficha no encola: sin_ancla", async () => {
		const { store, deps } = setup();
		const other = {
			...touch,
			ancla: { hecho: "Abrió planta", fuente: "https://acme.test/otra-nota" },
		};
		expect(await queueTouch(other, deps)).toMatchObject({
			ok: false,
			reason: "sin_ancla",
		});
		expect(store.queue).toHaveLength(0);
		expect(store.events).toHaveLength(0);
	});

	it("una pieza de followup guarda el hilo y el mensaje al que responde", async () => {
		const { store, deps } = setup();
		// Un followup real cae sobre un contacto ya tocado, no sobre uno fresco.
		store.contacts[0].stage = "msg1_enviado";
		store.contacts[0].touches = 1;
		const result = await queueTouch(
			{
				caller,
				contactKey: "em:laura@acme.test",
				kind: "followup_2",
				subject: "Re: Crecer sin sumar gente",
				body: PASSING_BODY,
				hook: "h1",
				vector: "v1",
				idioma: "es_ar",
				replyToMessageId: "<laura-1@acme.test>",
				gmailThreadId: "t1",
			},
			deps,
		);
		expect(result).toMatchObject({ ok: true });
		expect(store.queue[0]).toMatchObject({
			kind: "followup_2",
			replyToMessageId: "<laura-1@acme.test>",
			gmailThreadId: "t1",
			ancla: null,
		});
	});

	it("un followup no exige ancla, a diferencia del msg1", async () => {
		// El check de la base solo exige ancla para kind = 'msg1'.
		const { store, deps } = setup();
		store.contacts[0].stage = "msg1_enviado";
		store.contacts[0].touches = 1;
		const result = await queueTouch(
			{
				caller,
				contactKey: "em:laura@acme.test",
				kind: "followup_2",
				subject: "Re: x",
				body: PASSING_BODY,
				hook: "h1",
				vector: "v1",
				idioma: "es_ar",
				replyToMessageId: "<a@b.test>",
				gmailThreadId: "t1",
			},
			deps,
		);
		expect(result).toMatchObject({ ok: true });
	});

	it("un followup_2 sobre un contacto en msg1_enviado con un toque se encola bien", async () => {
		const { store, deps } = setup();
		store.contacts[0].stage = "msg1_enviado";
		store.contacts[0].touches = 1;
		const result = await queueTouch(
			{
				caller,
				contactKey: "em:laura@acme.test",
				kind: "followup_2",
				subject: "Re: seguimos en contacto",
				body: PASSING_BODY,
				hook: "h1",
				vector: "v1",
				idioma: "es_ar",
				replyToMessageId: "<laura-1@acme.test>",
				gmailThreadId: "t1",
			},
			deps,
		);
		expect(result).toMatchObject({ ok: true });
	});

	it("un followup sobre un contacto que ya respondió se refusa: no corresponde", async () => {
		const { store, deps } = setup();
		store.contacts[0].stage = "msg1_enviado";
		store.contacts[0].touches = 1;
		store.contacts[0].repliedAt = "2026-09-10T00:00:00Z";
		const result = await queueTouch(
			{
				caller,
				contactKey: "em:laura@acme.test",
				kind: "followup_2",
				subject: "Re: seguimos en contacto",
				body: PASSING_BODY,
				hook: "h1",
				vector: "v1",
				idioma: "es_ar",
				replyToMessageId: "<laura-1@acme.test>",
				gmailThreadId: "t1",
			},
			deps,
		);
		expect(result).toMatchObject({ ok: false, reason: "etapa_incompatible" });
	});

	it("un msg1 sobre un contacto ya tocado sigue refusado con la regla de siempre", async () => {
		const { store, deps } = setup();
		store.contacts[0].stage = "msg1_enviado";
		store.contacts[0].touches = 1;
		const result = await queueTouch(touch, deps);
		expect(result).toMatchObject({ ok: false, reason: "etapa_incompatible" });
		if (!result.ok) {
			expect(result.message).toContain(
				"el primer mensaje es solo para a_contactar",
			);
		}
	});
});

describe("listQueue, updateQueueItem, rejectQueueItem", () => {
	it("una pieza approved (trabada entre el claim y el envío) sale junto a las pending", async () => {
		const { store, deps } = setup();
		await queueTouch(touch, deps);
		store.queue[0].status = "approved";
		store.queue[0].approvedAt = "2026-09-15T12:00:00Z";
		store.contacts.push(
			contactRow({
				contactKey: "em:otra@acme.test",
				email: "otra@acme.test",
				name: "Otra Persona",
			}),
		);
		await queueTouch({ ...touch, contactKey: "em:otra@acme.test" }, deps);
		// La segunda pieza queda pending: solo la primera se marcó approved arriba.
		const listed = await listQueue({ caller }, deps);
		expect(listed.items).toHaveLength(2);
		const trabada = listed.items.find(
			(item) => item.contactKey === touch.contactKey,
		);
		const pendiente = listed.items.find(
			(item) => item.contactKey !== touch.contactKey,
		);
		expect(trabada).toMatchObject({
			trabada: true,
			approvedAt: "2026-09-15T12:00:00Z",
		});
		expect(pendiente).toMatchObject({ trabada: false, approvedAt: null });
	});

	it("lista con letras, edita solo el dueño y re-corre el gate, rechaza y libera el claim", async () => {
		const { store, deps } = setup();
		await queueTouch(touch, deps);
		const listed = await listQueue({ caller }, deps);
		expect(listed.items[0]).toMatchObject({
			letter: "A",
			to: "laura@acme.test",
			subject: touch.subject,
			trabada: false,
		});
		const id = listed.items[0].queueItemId;

		expect(
			await updateQueueItem(
				{
					caller: { ...caller, userId: OTHER_USER },
					queueItemId: id,
					subject: "Otro",
					body: PASSING_BODY,
				},
				deps,
			),
		).toMatchObject({ ok: false, reason: "no_es_tu_pieza" });
		expect(
			await updateQueueItem(
				{
					caller,
					queueItemId: id,
					subject: "Otro — asunto",
					body: PASSING_BODY,
				},
				deps,
			),
		).toMatchObject({ ok: false, reason: "gate" });
		expect(
			await updateQueueItem(
				{
					caller,
					queueItemId: id,
					subject: "Otra idea para Acme",
					body: PASSING_BODY,
				},
				deps,
			),
		).toMatchObject({ ok: true });
		expect(store.queue[0]).toMatchObject({
			subject: "Otra idea para Acme",
			draftOriginal: { subject: touch.subject },
		});

		expect(
			await rejectQueueItem(
				{ caller, queueItemId: id, reason: "no es ICP" },
				deps,
			),
		).toMatchObject({ ok: true });
		expect(store.queue[0]).toMatchObject({
			status: "rejected",
			error: "no es ICP",
		});
		expect(store.contacts[0].ownerUserId).toBeNull();
		expect(store.events.map((e) => e.type)).toEqual([
			"encolado",
			"pieza_editada",
			"rechazado",
		]);
	});
});
