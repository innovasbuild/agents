// tests/cola/actions.test.ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { GmailUnauthorizedError } from "@/lib/gmail/send";

const webSession = vi.fn();
const sendQueuedEmail = vi.fn();
const rejectQueueItem = vi.fn();
const updateQueueItem = vi.fn();
const startAuthorizationForSubject = vi.fn();

vi.mock("@/lib/outreach/web-session", () => ({ webSession }));
vi.mock("@/lib/outreach/services/send", () => ({ sendQueuedEmail }));
vi.mock("@/lib/outreach/services/queue", () => ({
	rejectQueueItem,
	updateQueueItem,
}));
vi.mock("@/lib/connectors/auth", () => ({ startAuthorizationForSubject }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

// Los tres se declaran antes del import dinámico: vi.mock se hoistea por
// encima de todo el archivo, así que cuando el import de abajo dispara la
// factory de este mock, necesita que ya estén inicializados (si no, TDZ:
// "Cannot access 'webSendDeps' before initialization").
const webSendDeps = vi.fn();
const webQueueDeps = vi.fn(async () => ({}));
// rejectItem no arma deps del CRM (hallazgo 2 del fix round 1): si esto no
// se mockea, corre la implementación real y pincha en createAdminClient()
// sin env de Supabase en el test.
const webStoreDeps = vi.fn(() => ({}));
vi.mock("@/lib/outreach/web-context", async () => {
	const actual = await vi.importActual<
		typeof import("@/lib/outreach/web-context")
	>("@/lib/outreach/web-context");
	return { ...actual, webSendDeps, webQueueDeps, webStoreDeps };
});
const { WebBindingMissing, WebReauthRequired } = await import(
	"@/lib/outreach/web-context"
);

const { approveAndSend, editItem, rejectItem } = await import(
	"@/app/[tenant]/cola/actions"
);

const SESSION = {
	caller: {
		tenantId: "t1",
		userId: "u1",
		role: "tenant_member",
		email: "mati@innov.as",
	},
	tenant: { id: "t1", slug: "innovas" },
};
const ITEM = "11111111-1111-4111-8111-111111111111";

// La pieza tal como está en la base (lo que devuelve getQueueItem) y tal como
// la ve la persona en pantalla antes de aprobar (row.toEmail/subject/body en
// cola-client.tsx): en estos tests arrancan iguales; el test de la guarda
// mueve PANTALLA para desalinearlos a propósito.
const BASE = {
	toEmail: "ana@acme.test",
	subject: "Crecer sin sumar gente",
	body: "Hola.",
};
const PANTALLA = { ...BASE };

// approveAndSend lee la pieza del store solo para confirmar que existe: el
// mock de webSendDeps tiene que traer un store, no un objeto vacío.
const depsConPieza = () => ({
	store: { getQueueItem: async () => ({ id: ITEM, ...BASE }) },
});

describe("approveAndSend", () => {
	beforeEach(() => {
		webSession.mockReset().mockResolvedValue(SESSION);
		sendQueuedEmail.mockReset();
		webSendDeps.mockReset().mockResolvedValue(depsConPieza());
		startAuthorizationForSubject.mockReset();
	});

	it("rechaza un id que no es uuid sin tocar el servicio", async () => {
		const result = await approveAndSend(
			"innovas",
			"no-es-uuid",
			PANTALLA.toEmail,
			PANTALLA.subject,
			PANTALLA.body,
		);

		expect(result.ok).toBe(false);
		expect(sendQueuedEmail).not.toHaveBeenCalled();
	});

	it("rechaza un toEmail que no es un email, sin tocar el servicio", async () => {
		const result = await approveAndSend(
			"innovas",
			ITEM,
			"no-es-un-email",
			PANTALLA.subject,
			PANTALLA.body,
		);

		expect(result.ok).toBe(false);
		expect(sendQueuedEmail).not.toHaveBeenCalled();
	});

	it("rechaza sin sesión", async () => {
		webSession.mockResolvedValue(null);

		const result = await approveAndSend(
			"innovas",
			ITEM,
			PANTALLA.toEmail,
			PANTALLA.subject,
			PANTALLA.body,
		);

		expect(result.ok).toBe(false);
		expect(sendQueuedEmail).not.toHaveBeenCalled();
	});

	it("devuelve el link de autorización cuando falta el grant", async () => {
		webSendDeps.mockRejectedValue(new WebReauthRequired("google"));
		startAuthorizationForSubject.mockResolvedValue({
			url: "https://connect.test/authorize",
			expiresAt: null,
		});

		const result = await approveAndSend(
			"innovas",
			ITEM,
			PANTALLA.toEmail,
			PANTALLA.subject,
			PANTALLA.body,
		);

		expect(result).toMatchObject({
			ok: false,
			authUrl: "https://connect.test/authorize",
			provider: "google",
		});
	});

	it("devuelve el link de autorización cuando Gmail rechaza el token al enviar", async () => {
		// A diferencia del hallazgo anterior (WebReauthRequired, que sale de
		// webSendDeps antes de intentar el envío), esto sale de sendQueuedEmail
		// después de intentar mandar: Gmail, no Connect, devolvió un 401.
		sendQueuedEmail.mockRejectedValue(new GmailUnauthorizedError());
		startAuthorizationForSubject.mockResolvedValue({
			url: "https://connect.test/authorize",
			expiresAt: null,
		});

		const result = await approveAndSend(
			"innovas",
			ITEM,
			PANTALLA.toEmail,
			PANTALLA.subject,
			PANTALLA.body,
		);

		expect(result).toMatchObject({
			ok: false,
			authUrl: "https://connect.test/authorize",
			provider: "google",
		});
	});

	it("avisa que falta habilitar Gmail sin ofrecer autorizar ni llamar a Connect (hallazgo 3)", async () => {
		// A diferencia de un grant vencido (WebReauthRequired, arriba), acá no
		// hay grant que reautorizar: el tenant no tiene el binding. Ofrecer un
		// link acá arrancaría una autorización sobre un grant que puede estar
		// perfecto, y el mensaje mentiría (autorizar no arregla una fila que
		// solo puede tocar un admin).
		webSendDeps.mockRejectedValue(new WebBindingMissing("google"));

		const result = await approveAndSend(
			"innovas",
			ITEM,
			PANTALLA.toEmail,
			PANTALLA.subject,
			PANTALLA.body,
		);

		expect(result.ok).toBe(false);
		expect((result as { authUrl?: string }).authUrl).toBeUndefined();
		expect(startAuthorizationForSubject).not.toHaveBeenCalled();
	});

	it("avisa cuando la pieza ya no está en la cola", async () => {
		webSendDeps.mockResolvedValue({
			store: { getQueueItem: async () => null },
		});

		const result = await approveAndSend(
			"innovas",
			ITEM,
			PANTALLA.toEmail,
			PANTALLA.subject,
			PANTALLA.body,
		);

		expect(result.ok).toBe(false);
		expect(sendQueuedEmail).not.toHaveBeenCalled();
	});

	it("propaga el mensaje de una negativa del servicio", async () => {
		sendQueuedEmail.mockResolvedValue({
			ok: false,
			reason: "no_es_tu_pieza",
			message: "solo quien encoló la pieza puede mandarla",
		});

		const result = await approveAndSend(
			"innovas",
			ITEM,
			PANTALLA.toEmail,
			PANTALLA.subject,
			PANTALLA.body,
		);

		expect(result).toEqual({
			ok: false,
			message: "solo quien encoló la pieza puede mandarla",
		});
	});

	it("manda a sendQueuedEmail el subject/body/toEmail de la pantalla, no los que lee del store (hallazgo 1)", async () => {
		sendQueuedEmail.mockResolvedValue({
			ok: true,
			queueItemId: ITEM,
			gmailMessageId: "m1",
			threadId: "th1",
			crm: "ok",
		});

		await approveAndSend(
			"innovas",
			ITEM,
			PANTALLA.toEmail,
			PANTALLA.subject,
			PANTALLA.body,
		);

		expect(sendQueuedEmail.mock.calls[0]?.[0]).toMatchObject({
			to: PANTALLA.toEmail,
			subject: PANTALLA.subject,
			body: PANTALLA.body,
		});
	});

	it("un subject desalineado con la base refusa y no envía (hallazgo 1)", async () => {
		// La guarda pieza_cambiada real vive en send.ts y ya tiene su propio
		// test (tests/outreach/services/send.test.ts); acá se prueba la parte
		// que le tocaba a la review: que approveAndSend reenvíe el subject que
		// la persona tiene en pantalla, no el que acaba de leer del store —
		// si lo leyera del store, la comparación de abajo sería contra sí
		// misma y nunca podría fallar. Este mock imita esa guarda para probar
		// el cableado sin reimplementarla.
		sendQueuedEmail.mockImplementation(async (input) => {
			if (
				input.to !== BASE.toEmail ||
				input.subject !== BASE.subject ||
				input.body !== BASE.body
			) {
				return {
					ok: false,
					reason: "pieza_cambiada",
					message:
						"la pieza cambió desde que se pidió la aprobación: volvé a leerla con list_queue y pedí aprobación con el texto actual",
				};
			}
			return {
				ok: true,
				queueItemId: ITEM,
				gmailMessageId: "m1",
				threadId: "th1",
				crm: "ok",
			};
		});

		const result = await approveAndSend(
			"innovas",
			ITEM,
			BASE.toEmail,
			"Asunto viejo que la persona ya no tiene en pantalla",
			BASE.body,
		);

		expect(result).toEqual({
			ok: false,
			message:
				"la pieza cambió desde que se pidió la aprobación: volvé a leerla con list_queue y pedí aprobación con el texto actual",
		});
		expect(sendQueuedEmail.mock.calls[0]?.[0]).toMatchObject({
			subject: "Asunto viejo que la persona ya no tiene en pantalla",
		});
	});

	it("contesta ok cuando el envío sale", async () => {
		sendQueuedEmail.mockResolvedValue({
			ok: true,
			queueItemId: ITEM,
			gmailMessageId: "m1",
			threadId: "th1",
			crm: "ok",
		});

		expect(
			await approveAndSend(
				"innovas",
				ITEM,
				PANTALLA.toEmail,
				PANTALLA.subject,
				PANTALLA.body,
			),
		).toEqual({ ok: true });
	});

	it("manda el sessionId con prefijo web: para distinguirlo del chat", async () => {
		sendQueuedEmail.mockResolvedValue({
			ok: true,
			queueItemId: ITEM,
			gmailMessageId: "m1",
			threadId: "th1",
			crm: "ok",
		});

		await approveAndSend(
			"innovas",
			ITEM,
			PANTALLA.toEmail,
			PANTALLA.subject,
			PANTALLA.body,
		);

		expect(sendQueuedEmail.mock.calls[0]?.[0].sessionId).toMatch(/^web:/);
	});
});

describe("editItem", () => {
	const SUBJECT = "Asunto editado";
	const BODY = "Cuerpo editado.";

	beforeEach(() => {
		webSession.mockReset().mockResolvedValue(SESSION);
		updateQueueItem.mockReset();
		webQueueDeps.mockReset().mockResolvedValue({});
		startAuthorizationForSubject.mockReset();
	});

	it("rechaza argumentos inválidos sin tocar el servicio", async () => {
		const result = await editItem("innovas", ITEM, "", BODY);

		expect(result.ok).toBe(false);
		expect(updateQueueItem).not.toHaveBeenCalled();
		expect(webSession).not.toHaveBeenCalled();
	});

	it("rechaza sin sesión", async () => {
		webSession.mockResolvedValue(null);

		const result = await editItem("innovas", ITEM, SUBJECT, BODY);

		expect(result.ok).toBe(false);
		expect(updateQueueItem).not.toHaveBeenCalled();
	});

	it("propaga la negativa cuando la pieza es ajena", async () => {
		updateQueueItem.mockResolvedValue({
			ok: false,
			reason: "no_es_tu_pieza",
			message: "solo quien encoló la pieza puede editarla",
		});

		const result = await editItem("innovas", ITEM, SUBJECT, BODY);

		expect(result).toEqual({
			ok: false,
			message: "solo quien encoló la pieza puede editarla",
		});
	});

	it("propaga la negativa cuando la edición no pasa el gate", async () => {
		updateQueueItem.mockResolvedValue({
			ok: false,
			reason: "gate",
			message: "la edición no pasa el gate: tono agresivo",
		});

		const result = await editItem("innovas", ITEM, SUBJECT, BODY);

		expect(result).toEqual({
			ok: false,
			message: "la edición no pasa el gate: tono agresivo",
		});
	});

	it("edita con éxito y revalida la cola", async () => {
		updateQueueItem.mockResolvedValue({ ok: true, queueItemId: ITEM });

		const result = await editItem("innovas", ITEM, SUBJECT, BODY);

		expect(result).toEqual({ ok: true });
		expect(updateQueueItem).toHaveBeenCalledWith(
			{
				caller: SESSION.caller,
				queueItemId: ITEM,
				subject: SUBJECT,
				body: BODY,
			},
			{},
		);
	});

	it("devuelve el link de autorización de HubSpot cuando falta el grant (único disparador de provider: hubspot)", async () => {
		// editItem es la única de las tres actions que arma deps con
		// webQueueDeps (crmForSession de por medio): es el único camino que
		// puede pedir reautorizar HubSpot, no Google.
		webQueueDeps.mockRejectedValue(new WebReauthRequired("hubspot"));
		startAuthorizationForSubject.mockResolvedValue({
			url: "https://connect.test/authorize-hubspot",
			expiresAt: null,
		});

		const result = await editItem("innovas", ITEM, SUBJECT, BODY);

		expect(result).toMatchObject({
			ok: false,
			authUrl: "https://connect.test/authorize-hubspot",
			provider: "hubspot",
		});
	});

	it("avisa que falta habilitar HubSpot sin ofrecer autorizar (hallazgo 3, vía webQueueDeps)", async () => {
		webQueueDeps.mockRejectedValue(new WebBindingMissing("hubspot"));

		const result = await editItem("innovas", ITEM, SUBJECT, BODY);

		expect(result.ok).toBe(false);
		expect((result as { authUrl?: string }).authUrl).toBeUndefined();
		expect(startAuthorizationForSubject).not.toHaveBeenCalled();
	});
});

describe("rejectItem", () => {
	beforeEach(() => {
		webSession.mockReset().mockResolvedValue(SESSION);
		rejectQueueItem.mockReset();
		webQueueDeps.mockClear();
		webStoreDeps.mockClear();
	});

	it("exige un motivo no vacío", async () => {
		const result = await rejectItem("innovas", ITEM, "   ");

		expect(result.ok).toBe(false);
		expect(rejectQueueItem).not.toHaveBeenCalled();
	});

	it("descarta la pieza con el motivo", async () => {
		rejectQueueItem.mockResolvedValue({ ok: true, queueItemId: ITEM });

		expect(await rejectItem("innovas", ITEM, "muy genérico")).toEqual({
			ok: true,
		});
	});

	it("no arma dependencias del CRM: rechazar no las necesita", async () => {
		// Hallazgo 2 del fix round 1: webQueueDeps pide token de HubSpot de
		// forma eager, que rejectQueueItem (Pick<QueueDeps, "store" | "now">)
		// nunca toca. Si esto se rompiera, rechazar una pieza podría explotar
		// por un grant de HubSpot vencido, sin relación con la operación.
		rejectQueueItem.mockResolvedValue({ ok: true, queueItemId: ITEM });

		await rejectItem("innovas", ITEM, "muy genérico");

		expect(webStoreDeps).toHaveBeenCalledTimes(1);
		expect(webQueueDeps).not.toHaveBeenCalled();
	});
});
