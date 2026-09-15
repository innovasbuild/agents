import { parseOutreachConfig } from "@/lib/outreach/config";
import type { OutreachEventInsert } from "@/lib/outreach/events";
import type {
	AccountRow,
	ContactRow,
	ExecutorRow,
	NewContact,
	NewQueueItem,
	OutreachStore,
	QueueItemRow,
	TenantOutreach,
} from "@/lib/outreach/store";

// Cuerpo de mail que pasa runGate con reglas vacías. Lo comparten los tests de
// draft, queue y send; agents/outreach/evals/support.ts tiene su propia copia
// (no puede importar de tests/).
export const PASSING_BODY = [
	"Hola Laura,",
	"",
	"Vi que Acme abrió una segunda planta en Rafaela este año. Cuando la operación crece así, el costo de coordinar crece más rápido que la facturación.",
	"",
	"Armamos con equipos como el tuyo un tablero que ordena pedidos y compras sin sumar gente al back office.",
	"",
	"Si te sirve, te cuento en 30 minutos cómo lo aplicamos en una empresa del rubro. Tenés un rato el jueves?",
].join("\n");

export interface FakeStore extends OutreachStore {
	executors: ExecutorRow[];
	tenants: Map<string, TenantOutreach>;
	contacts: ContactRow[];
	accounts: AccountRow[];
	queue: QueueItemRow[];
	events: OutreachEventInsert[];
}

let counter = 0;
const nextId = (prefix: string) => `${prefix}-${++counter}`;

export const TENANT = "tenant-1";
export const USER = "user-1";
export const OTHER_USER = "user-2";

export function defaultTenant(
	overrides: Partial<TenantOutreach> = {},
): TenantOutreach {
	return {
		config: parseOutreachConfig({ timezone: "America/Argentina/Buenos_Aires" }),
		values: {
			segmento: ["mid_market_ar"],
			vector: ["v1"],
			hook: ["h1"],
			idioma: ["es_ar", "es_es"],
		},
		defaultHooks: { v1: "h1" },
		...overrides,
	};
}

export function contactRow(overrides: Partial<ContactRow> = {}): ContactRow {
	return {
		id: nextId("contact"),
		tenantId: TENANT,
		contactKey: "em:laura@acme.test",
		accountId: null,
		name: "Laura Gómez",
		company: "Acme",
		email: "laura@acme.test",
		linkedinSlug: null,
		crmId: null,
		ownerUserId: null,
		segment: "mid_market_ar",
		vector: "v1",
		hook: "h1",
		idioma: "es_ar",
		stage: "a_contactar",
		touches: 0,
		firstTouchAt: null,
		lastTouchAt: null,
		nextStepAt: null,
		repliedAt: null,
		gmailThreadId: null,
		source: "csv",
		...overrides,
	};
}

export function createFakeStore(): FakeStore {
	const store: FakeStore = {
		executors: [
			{
				tenantId: TENANT,
				userId: USER,
				slug: "ana",
				crmOwnerId: null,
				dailyQuota: 30,
				gmailAuthorizedAt: null,
			},
		],
		tenants: new Map([[TENANT, defaultTenant()]]),
		contacts: [],
		accounts: [],
		queue: [],
		events: [],

		async loadExecutor(tenantId, userId) {
			return (
				store.executors.find(
					(e) => e.tenantId === tenantId && e.userId === userId,
				) ?? null
			);
		},
		async loadTenantOutreach(tenantId) {
			return store.tenants.get(tenantId) ?? null;
		},
		async findContactsByKeys(tenantId, keys) {
			return store.contacts.filter(
				(c) => c.tenantId === tenantId && keys.includes(c.contactKey),
			);
		},
		async insertContact(row: NewContact) {
			const contact = contactRow({
				...row,
				id: nextId("contact"),
				ownerUserId: null,
				hook: null,
				idioma: null,
			});
			store.contacts.push(contact);
			return contact;
		},
		async updateContact(tenantId, id, patch) {
			const contact = store.contacts.find(
				(c) => c.tenantId === tenantId && c.id === id,
			);
			if (!contact) throw new Error(`contacto ${id} inexistente`);
			Object.assign(
				contact,
				Object.fromEntries(
					Object.entries(patch).filter(([, v]) => v !== undefined),
				),
			);
			return contact;
		},
		async findAccount(tenantId, domain) {
			return (
				store.accounts.find(
					(a) => a.tenantId === tenantId && a.domain === domain,
				) ?? null
			);
		},
		async upsertAccount(row) {
			const existing = store.accounts.find(
				(a) => a.tenantId === row.tenantId && a.domain === row.domain,
			);
			if (existing) {
				Object.assign(existing, row);
				return existing;
			}
			const account = { ...row, id: nextId("account") };
			store.accounts.push(account);
			return account;
		},
		async insertQueueItem(row: NewQueueItem) {
			const live = store.queue.some(
				(q) =>
					q.tenantId === row.tenantId &&
					q.contactId === row.contactId &&
					(q.status === "pending" || q.status === "approved"),
			);
			if (live) return "pieza_viva";
			const item: QueueItemRow = {
				...row,
				id: nextId("queue"),
				status: "pending",
				expiresAt: new Date(Date.now() + 7 * 86_400_000).toISOString(),
				gmailMessageId: null,
				approvedAt: null,
				sentAt: null,
				error: null,
				eveSessionId: null,
				approvalCallId: null,
				createdAt: new Date(Date.now() + counter).toISOString(),
			};
			store.queue.push(item);
			return item;
		},
		async getQueueItem(tenantId, id) {
			return (
				store.queue.find((q) => q.tenantId === tenantId && q.id === id) ?? null
			);
		},
		async listQueue(tenantId, executorUserId, status) {
			return store.queue.filter(
				(q) =>
					q.tenantId === tenantId &&
					q.executorUserId === executorUserId &&
					q.status === status,
			);
		},
		async transitionQueueItem(tenantId, id, from, patch) {
			const item = store.queue.find(
				(q) => q.tenantId === tenantId && q.id === id && q.status === from,
			);
			if (!item) return null;
			Object.assign(
				item,
				Object.fromEntries(
					Object.entries(patch).filter(([, v]) => v !== undefined),
				),
			);
			return item;
		},
		async countSent(tenantId, filter) {
			const rows = store.queue
				.filter(
					(q) =>
						q.tenantId === tenantId &&
						q.status === "sent" &&
						q.sentAt &&
						new Date(q.sentAt) >= filter.since,
				)
				.filter(
					(q) =>
						!filter.executorUserId ||
						q.executorUserId === filter.executorUserId,
				)
				.filter((q) => !filter.toEmail || q.toEmail === filter.toEmail)
				.filter(
					(q) =>
						!filter.excludeThreadId ||
						q.gmailThreadId !== filter.excludeThreadId,
				)
				.sort((a, b) => (b.sentAt ?? "").localeCompare(a.sentAt ?? ""));
			return {
				count: rows.length,
				lastSentAt: rows[0]?.sentAt ? new Date(rows[0].sentAt) : null,
			};
		},
		async insertEvents(rows) {
			store.events.push(...rows);
		},
	};
	return store;
}
