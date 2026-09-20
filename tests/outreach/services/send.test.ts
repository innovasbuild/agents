import { describe, expect, it, vi } from "vitest";
import type { CrmAdapter } from "@/lib/connectors/crm/adapter";
import type { Canon } from "@/lib/outreach/canon";
import { emptyGateRules } from "@/lib/outreach/gate-blocks";
import { listQueue, queueTouch } from "@/lib/outreach/services/queue";
import { sendQueuedEmail } from "@/lib/outreach/services/send";
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

class FakeUnauthorized extends Error {}
class FakeUnknownOutcome extends Error {}

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
// Sin binding de brain, o con brain sin páginas de canon: no se envía.
const CANON_VACIO: Canon = {
	available: false,
	pages: [],
	voice: [],
	rules: emptyGateRules(),
};
const SUBJECT = "Crecer sin sumar gente";

// queueTouch (Task 22/23) exige ficha vigente con el ancla citada: el brief
// de esta task no la incluía en el setup, así que se agrega acá (mínimo,
// documentado en el reporte) igual que en tests/outreach/services/queue.test.ts.
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

function crmSpy(overrides: Partial<CrmAdapter> = {}) {
	const calls: string[] = [];
	const adapter = fakeCrm({
		upsertContact: async (input) => {
			calls.push(`upsert:${JSON.stringify(input.properties)}`);
			return "crm-1";
		},
		addNote: async (_id, note) => {
			calls.push(`note:${note.body.split("\n")[0]}`);
		},
		completeOpenTasks: async () => {
			calls.push("complete");
		},
		createTask: async (_id, task) => {
			calls.push(`task:${task.dueAt.toISOString()}`);
		},
		...overrides,
	});
	return { adapter, calls };
}

async function setup(
	options: { crm?: CrmAdapter | null; crmOwner?: string | null } = {},
) {
	const store = createFakeStore();
	store.executors[0].crmOwnerId =
		options.crmOwner === undefined ? null : options.crmOwner;
	store.tenants.get(TENANT)!.config.bcc = "123@bcc.hubspot.com";
	store.contacts.push(contactRow());
	store.accounts.push(accountRow());
	const crm = options.crm ?? null;
	const queued = await queueTouch(
		{
			caller,
			contactKey: "em:laura@acme.test",
			kind: "msg1",
			subject: SUBJECT,
			body: PASSING_BODY,
			hook: "h1",
			vector: "v1",
			idioma: "es_ar",
			ancla: { hecho: "Abrió planta", fuente: "https://acme.test/n" },
		},
		{ store, crm, loadCanon: async () => canon, now },
	);
	if (!queued.ok) throw new Error(queued.message);
	const sendMail = vi.fn(async () => ({ id: "gm-1", threadId: "th-1" }));
	const deps = {
		store,
		crm,
		crmAfterSend: crm,
		loadCanon: async () => canon,
		sendMail,
		isMailUnauthorized: (e: unknown) => e instanceof FakeUnauthorized,
		isMailUnknownOutcome: (e: unknown) => e instanceof FakeUnknownOutcome,
		now,
	};
	const input = {
		caller,
		sessionId: "wrun_1",
		callId: "call-1",
		queueItemId: queued.queueItemId,
		to: "laura@acme.test",
		subject: SUBJECT,
		body: PASSING_BODY,
	};
	return { store, deps, input, sendMail };
}

describe("sendQueuedEmail", () => {
	it("envía la pieza aprobada con BCC y Message-ID propio, y registra base y eventos", async () => {
		const { store, deps, input, sendMail } = await setup();
		expect(await sendQueuedEmail(input, deps)).toEqual({
			ok: true,
			queueItemId: input.queueItemId,
			gmailMessageId: "gm-1",
			threadId: "th-1",
			crm: "sin_crm",
		});
		expect(sendMail).toHaveBeenCalledWith({
			to: "laura@acme.test",
			subject: SUBJECT,
			body: PASSING_BODY,
			bcc: "123@bcc.hubspot.com",
			messageId: `<qi-${input.queueItemId}@innov.test>`,
		});
		expect(store.queue[0]).toMatchObject({
			status: "sent",
			gmailMessageId: "gm-1",
			gmailThreadId: "th-1",
			eveSessionId: "wrun_1",
			approvalCallId: "call-1",
		});
		expect(store.contacts[0]).toMatchObject({
			stage: "msg1_enviado",
			touches: 1,
			gmailThreadId: "th-1",
			firstTouchAt: "2026-09-15T12:00:00.000Z",
			nextStepAt: "2026-09-19T12:00:00.000Z",
		});
		expect(store.events.map((e) => e.type)).toEqual(["encolado", "envio"]);
	});

	it("una segunda llamada con la misma pieza no envía de nuevo", async () => {
		const { deps, input, sendMail } = await setup();
		await sendQueuedEmail(input, deps);
		expect(await sendQueuedEmail(input, deps)).toMatchObject({
			ok: false,
			reason: "ya_tomada",
		});
		expect(sendMail).toHaveBeenCalledTimes(1);
	});

	it("lo aprobado es lo enviado: si la pieza cambió, no envía", async () => {
		const { deps, input, sendMail } = await setup();
		expect(
			await sendQueuedEmail({ ...input, subject: "Otro asunto" }, deps),
		).toMatchObject({ ok: false, reason: "pieza_cambiada" });
		expect(sendMail).not.toHaveBeenCalled();
	});

	it("lo aprobado es lo enviado: si el destinatario no coincide, no envía", async () => {
		const { deps, input, sendMail } = await setup();
		expect(
			await sendQueuedEmail({ ...input, to: "otra@acme.test" }, deps),
		).toMatchObject({ ok: false, reason: "pieza_cambiada" });
		expect(sendMail).not.toHaveBeenCalled();
	});

	it("el destinatario se compara sin distinguir mayúsculas: envía al guardado en minúsculas", async () => {
		const { deps, input, sendMail } = await setup();
		expect(
			await sendQueuedEmail({ ...input, to: "Laura@Acme.test" }, deps),
		).toMatchObject({ ok: true });
		expect(sendMail).toHaveBeenCalledWith(
			expect.objectContaining({ to: "laura@acme.test" }),
		);
	});

	it("solo el dueño de la pieza la envía", async () => {
		const { store, deps, input } = await setup();
		store.executors.push({
			tenantId: TENANT,
			userId: OTHER_USER,
			slug: "beto",
			crmOwnerId: null,
			dailyQuota: 30,
			gmailAuthorizedAt: null,
			gmailReadAuthorizedAt: null,
		});
		expect(
			await sendQueuedEmail(
				{ ...input, caller: { ...caller, userId: OTHER_USER } },
				deps,
			),
		).toMatchObject({ ok: false, reason: "no_es_tu_pieza" });
	});

	it("Gmail sin autorización: la pieza vuelve a pending y el error sube; al reintentar sale una sola vez", async () => {
		const { store, deps, input, sendMail } = await setup();
		sendMail.mockRejectedValueOnce(new FakeUnauthorized("401"));
		await expect(sendQueuedEmail(input, deps)).rejects.toBeInstanceOf(
			FakeUnauthorized,
		);
		expect(store.queue[0].status).toBe("pending");
		expect(await sendQueuedEmail(input, deps)).toMatchObject({ ok: true });
		expect(sendMail).toHaveBeenCalledTimes(2);
		expect(store.events.filter((e) => e.type === "envio")).toHaveLength(1);
	});

	it("cupo diario: transitorio, vuelve a pending sin enviar", async () => {
		const { store, deps, input, sendMail } = await setup();
		store.executors[0].dailyQuota = 0;
		expect(await sendQueuedEmail(input, deps)).toMatchObject({
			ok: false,
			reason: "cupo_diario",
		});
		expect(store.queue[0].status).toBe("pending");
		expect(sendMail).not.toHaveBeenCalled();
	});

	it("Gmail contestó con un status (500): el mail no salió, la pieza queda failed con evento", async () => {
		const { store, deps, input, sendMail } = await setup();
		sendMail.mockRejectedValueOnce(
			new Error("Gmail no pudo enviar el mail (500)"),
		);
		expect(await sendQueuedEmail(input, deps)).toMatchObject({
			ok: false,
			reason: "envio_fallido",
		});
		expect(store.queue[0]).toMatchObject({ status: "failed" });
		expect(store.events.map((e) => e.type)).toContain("envio_fallido");
	});

	it("sin respuesta de Gmail no se sabe si salió: la pieza queda trabada, sin tocar toques ni enviados", async () => {
		const { store, deps, input, sendMail } = await setup();
		sendMail.mockRejectedValueOnce(new FakeUnknownOutcome("ECONNRESET"));
		const result = await sendQueuedEmail(input, deps);
		expect(result).toMatchObject({ ok: false, reason: "envio_incierto" });
		expect((result as { message: string }).message).toContain(
			"Revisá en Gmail si el mail salió antes de reintentar",
		);
		expect(store.queue[0]).toMatchObject({
			status: "approved",
			error: expect.stringContaining("envio_incierto:"),
			approvedAt: "2026-09-15T12:00:00.000Z",
		});
		expect(store.contacts[0]).toMatchObject({
			touches: 0,
			stage: "a_contactar",
		});
		expect(await store.countSent(TENANT, { since: new Date(0) })).toMatchObject(
			{ count: 0 },
		);
		expect(store.events.map((e) => e.type)).toEqual(["encolado"]);
		// Trabada: no se puede reencolar (pieza viva) ni reenviar (no está pending).
		expect(await sendQueuedEmail(input, deps)).toMatchObject({
			ok: false,
			reason: "ya_tomada",
		});
		expect(sendMail).toHaveBeenCalledTimes(1);
	});

	it("Gmail contestó 2xx pero sin confirmar el id: incierto, no fallido", async () => {
		const { store, deps, input, sendMail } = await setup();
		sendMail.mockResolvedValueOnce({ id: "", threadId: "" });
		const result = await sendQueuedEmail(input, deps);
		expect(result).toMatchObject({ ok: false, reason: "envio_incierto" });
		expect((result as { message: string }).message).toContain(
			"Revisá en Gmail si el mail salió antes de reintentar",
		);
		expect(store.queue[0]).toMatchObject({
			status: "approved",
			error: expect.stringContaining("envio_incierto:"),
		});
		expect(store.contacts[0]).toMatchObject({ touches: 0 });
		expect(await store.countSent(TENANT, { since: new Date(0) })).toMatchObject(
			{ count: 0 },
		);
		expect(store.events.map((e) => e.type)).toEqual(["encolado"]);
	});

	it("una pieza trabada muestra en list_queue por qué quedó trabada", async () => {
		const { store, deps, input, sendMail } = await setup();
		sendMail.mockRejectedValueOnce(new FakeUnknownOutcome("ECONNRESET"));
		await sendQueuedEmail(input, deps);
		const listed = await listQueue({ caller }, { store });
		expect(listed.items[0]).toMatchObject({
			trabada: true,
			error: expect.stringContaining("envio_incierto:"),
		});
	});

	it("un canon vacío (tenant sin brain o sin canon cargado) no envía", async () => {
		const { store, deps, input, sendMail } = await setup();
		expect(
			await sendQueuedEmail(input, {
				...deps,
				loadCanon: async () => CANON_VACIO,
			}),
		).toMatchObject({
			ok: false,
			reason: "canon_no_disponible",
			message: expect.stringContaining("no está conectado"),
		});
		expect(sendMail).not.toHaveBeenCalled();
		expect(store.queue[0].status).toBe("pending");
	});

	it("con CRM: 9 propiedades (sin outreach_fecha_respuesta) en la misma llamada, nota [out], cierre de tasks y task al siguiente toque", async () => {
		const { adapter, calls } = crmSpy();
		const { deps, input } = await setup({
			crm: adapter,
			crmOwner: "owner-ana",
		});
		expect(await sendQueuedEmail(input, deps)).toMatchObject({
			ok: true,
			crm: "ok",
		});
		const upsert = JSON.parse(calls[0].replace("upsert:", ""));
		expect(upsert).toEqual({
			contact_key: "em:laura@acme.test",
			outreach_segmento: "mid_market_ar",
			outreach_canal: "email",
			outreach_hook: "h1",
			outreach_vector: "v1",
			outreach_idioma: "es_ar",
			outreach_status: "msg1_enviado",
			outreach_owner: "ana",
			outreach_fecha_msg1: "2026-09-15",
		});
		expect(calls.slice(1)).toEqual([
			"note:[out · msg1 · email · v1 · h1]",
			"complete",
			"task:2026-09-19T12:00:00.000Z",
		]);
	});

	it("si el CRM falla después de enviar: no reenvía, queda crm_sync_pendiente y devuelve ok", async () => {
		const { adapter } = crmSpy({
			upsertContact: async () => {
				throw new Error("HubSpot respondió 500");
			},
		});
		const { store, deps, input, sendMail } = await setup({
			crm: adapter,
			crmOwner: "owner-ana",
		});
		expect(await sendQueuedEmail(input, deps)).toMatchObject({
			ok: true,
			crm: "pendiente",
		});
		expect(sendMail).toHaveBeenCalledTimes(1);
		expect(store.queue[0].status).toBe("sent");
		expect(store.events.map((e) => e.type)).toEqual([
			"encolado",
			"envio",
			"crm_sync_pendiente",
		]);
	});

	it("un error antes de enviar (por ejemplo el CRM pidiendo autorización) devuelve la pieza a pending", async () => {
		const { adapter } = crmSpy({
			lastAuthorship: async () => {
				throw new Error("auth requerida");
			},
		});
		const { store, deps, input, sendMail } = await setup({
			crm: null,
			crmOwner: "owner-ana",
		});
		store.contacts[0].crmId = "crm-1";
		await expect(
			sendQueuedEmail(input, { ...deps, crm: adapter }),
		).rejects.toThrow("auth requerida");
		expect(store.queue[0].status).toBe("pending");
		expect(sendMail).not.toHaveBeenCalled();
	});
});
