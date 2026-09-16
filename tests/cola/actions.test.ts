// tests/cola/actions.test.ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { GmailUnauthorizedError } from "@/lib/gmail/send";

const webSession = vi.fn();
const sendQueuedEmail = vi.fn();
const rejectQueueItem = vi.fn();
const startAuthorizationForSubject = vi.fn();

vi.mock("@/lib/outreach/web-session", () => ({ webSession }));
vi.mock("@/lib/outreach/services/send", () => ({ sendQueuedEmail }));
vi.mock("@/lib/outreach/services/queue", () => ({
	rejectQueueItem,
	updateQueueItem: vi.fn(),
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
const { WebReauthRequired } = await import("@/lib/outreach/web-context");

const { approveAndSend, rejectItem } = await import(
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

// approveAndSend lee la pieza del store antes de enviar: el mock de
// webSendDeps tiene que traer un store, no un objeto vacío.
const depsConPieza = () => ({
	store: {
		getQueueItem: async () => ({
			id: ITEM,
			toEmail: "ana@acme.test",
			subject: "Crecer sin sumar gente",
			body: "Hola.",
		}),
	},
});

describe("approveAndSend", () => {
	beforeEach(() => {
		webSession.mockReset().mockResolvedValue(SESSION);
		sendQueuedEmail.mockReset();
		webSendDeps.mockReset().mockResolvedValue(depsConPieza());
		startAuthorizationForSubject.mockReset();
	});

	it("rechaza un id que no es uuid sin tocar el servicio", async () => {
		const result = await approveAndSend("innovas", "no-es-uuid");

		expect(result.ok).toBe(false);
		expect(sendQueuedEmail).not.toHaveBeenCalled();
	});

	it("rechaza sin sesión", async () => {
		webSession.mockResolvedValue(null);

		const result = await approveAndSend("innovas", ITEM);

		expect(result.ok).toBe(false);
		expect(sendQueuedEmail).not.toHaveBeenCalled();
	});

	it("devuelve el link de autorización cuando falta el grant", async () => {
		webSendDeps.mockRejectedValue(new WebReauthRequired("google"));
		startAuthorizationForSubject.mockResolvedValue({
			url: "https://connect.test/authorize",
			expiresAt: null,
		});

		const result = await approveAndSend("innovas", ITEM);

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

		const result = await approveAndSend("innovas", ITEM);

		expect(result).toMatchObject({
			ok: false,
			authUrl: "https://connect.test/authorize",
			provider: "google",
		});
	});

	it("avisa cuando la pieza ya no está en la cola", async () => {
		webSendDeps.mockResolvedValue({
			store: { getQueueItem: async () => null },
		});

		const result = await approveAndSend("innovas", ITEM);

		expect(result.ok).toBe(false);
		expect(sendQueuedEmail).not.toHaveBeenCalled();
	});

	it("propaga el mensaje de una negativa del servicio", async () => {
		sendQueuedEmail.mockResolvedValue({
			ok: false,
			reason: "no_es_tu_pieza",
			message: "solo quien encoló la pieza puede mandarla",
		});

		const result = await approveAndSend("innovas", ITEM);

		expect(result).toEqual({
			ok: false,
			message: "solo quien encoló la pieza puede mandarla",
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

		expect(await approveAndSend("innovas", ITEM)).toEqual({ ok: true });
	});

	it("manda el sessionId con prefijo web: para distinguirlo del chat", async () => {
		sendQueuedEmail.mockResolvedValue({
			ok: true,
			queueItemId: ITEM,
			gmailMessageId: "m1",
			threadId: "th1",
			crm: "ok",
		});

		await approveAndSend("innovas", ITEM);

		expect(sendQueuedEmail.mock.calls[0]?.[0].sessionId).toMatch(/^web:/);
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
