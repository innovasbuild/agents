import type { CrmAdapter } from "@/lib/connectors/crm/adapter";
import { parseOutreachConfig } from "@/lib/outreach/config";
import type { OutreachEventInsert } from "@/lib/outreach/events";
import type { Ficha } from "@/lib/outreach/ficha";
import { isNoResponse } from "@/lib/outreach/stage";
import type {
	AccountRow,
	ContactRow,
	ExecutorRow,
	FocusRow,
	NewContact,
	NewQueueItem,
	OutreachStore,
	PendingReply,
	QueueItemRow,
	TenantOutreach,
} from "@/lib/outreach/store";

// Cuerpo de mail que pasa runGate con reglas vacías. Lo comparten los tests de
// draft, queue y send; agents/outreach/evals/support.ts tiene su propia copia
// (no puede importar de tests/).
export const PASSING_BODY = [
	"Hola Laura,",
	"",
	"Una empresa como Acme, con dos plantas en Rafaela, sabe que el costo de coordinar pedidos entre ellas crece más rápido que la facturación.",
	"",
	"Armamos con equipos como el tuyo un tablero que ordena pedidos y compras sin sumar gente al back office.",
	"",
	"Si te sirve, te cuento en 30 minutos cómo lo aplicamos en una empresa del rubro. Tenés un rato el jueves?",
].join("\n");

export interface FakeStore extends OutreachStore {
	executors: ExecutorRow[];
	tenants: Map<string, TenantOutreach>;
	tenantActive: Map<string, boolean>;
	contacts: ContactRow[];
	accounts: AccountRow[];
	queue: QueueItemRow[];
	events: OutreachEventInsert[];
	focuses: FocusRow[];
	contactSeed(): ContactRow;
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
		labels: {
			segmento: { mid_market_ar: "Mid market Argentina" },
			vector: { v1: "Vector de prueba" },
			hook: { h1: "Hook de prueba" },
			idioma: { es_ar: "Español rioplatense", es_es: "Español peninsular" },
		},
		defaultHooks: { v1: "h1" },
		...overrides,
	};
}

// CRM falso: sin matches ni autoría. Cada test pisa solo lo que necesita.
export function fakeCrm(overrides: Partial<CrmAdapter> = {}): CrmAdapter {
	return {
		findContacts: async () => [],
		lastAuthorship: async () => null,
		upsertContact: async () => "crm-1",
		addNote: async () => {},
		completeOpenTasks: async () => {},
		createTask: async () => {},
		listOpenDeals: async () => [],
		createDeal: async () => ({ id: "deal-1" }),
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
	// La base real tiene `created_at` en `events`, generado por la columna;
	// acá no hay fila real, así que se sintetiza uno monótono por inserción
	// para que listPendingReplies pueda devolver una `fecha` y preservar
	// orden cronológico entre eventos del mismo contacto.
	let eventSeq = 0;
	const eventCreatedAt = new WeakMap<OutreachEventInsert, string>();

	const store: FakeStore = {
		executors: [
			{
				tenantId: TENANT,
				userId: USER,
				slug: "ana",
				crmOwnerId: null,
				dailyQuota: 30,
				gmailAuthorizedAt: null,
				gmailReadAuthorizedAt: null,
			},
		],
		tenants: new Map([[TENANT, defaultTenant()]]),
		tenantActive: new Map([[TENANT, true]]),
		contacts: [],
		accounts: [],
		queue: [],
		events: [],
		focuses: [],

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
		async findAccountById(tenantId, id) {
			return (
				store.accounts.find((a) => a.tenantId === tenantId && a.id === id) ??
				null
			);
		},
		// No modela work_items: devuelve todas las vencidas. La exclusión de lo ya
		// encolado la prueban 15_refresh_fichas_candidates.test.sql y el test de
		// integración de tests/workflows/store.it.test.ts.
		async listAccountsToRefresh(tenantId, now, limit) {
			return store.accounts
				.filter(
					(a) =>
						a.tenantId === tenantId &&
						new Date(a.expiresAt).getTime() <= now.getTime(),
				)
				.sort((a, b) => a.expiresAt.localeCompare(b.expiresAt))
				.slice(0, limit)
				.map(({ id, domain, name, researchedAt, expiresAt }) => ({
					id,
					domain,
					name,
					researchedAt,
					expiresAt,
				}));
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
		async listQueue(tenantId, executorUserId, statuses) {
			return store.queue.filter(
				(q) =>
					q.tenantId === tenantId &&
					q.executorUserId === executorUserId &&
					statuses.includes(q.status),
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
			for (const row of rows) {
				eventCreatedAt.set(
					row,
					new Date(2026, 0, 1, 0, ++eventSeq).toISOString(),
				);
			}
			store.events.push(...rows);
		},

		async listActiveTenants() {
			const tenants: { id: string; slug: string }[] = [];
			for (const [id] of store.tenants.entries()) {
				if (store.tenantActive.get(id) === true) {
					tenants.push({ id, slug: id });
				}
			}
			return tenants;
		},

		async listExecutorsWithGmailRead(tenantId) {
			return store.executors.filter(
				(e) => e.tenantId === tenantId && e.gmailReadAuthorizedAt !== null,
			);
		},

		async listContactsWithThread(tenantId, ownerUserId) {
			return store.contacts.filter(
				(c) =>
					c.tenantId === tenantId &&
					c.ownerUserId === ownerUserId &&
					c.gmailThreadId !== null,
			);
		},

		async listDueFollowups(tenantId, now) {
			// Mismo universo que listContactsWithThread: solo contactos de un
			// ejecutor con lectura de Gmail (ver la store real).
			const readers = new Set(
				store.executors
					.filter(
						(e) => e.tenantId === tenantId && e.gmailReadAuthorizedAt !== null,
					)
					.map((e) => e.userId),
			);
			return store.contacts.filter(
				(c) =>
					c.tenantId === tenantId &&
					c.ownerUserId !== null &&
					readers.has(c.ownerUserId) &&
					c.nextStepAt !== null &&
					new Date(c.nextStepAt) <= now &&
					c.touches < 3 &&
					c.repliedAt === null,
			);
		},

		async listExhaustedContacts(tenantId, now) {
			// Idempotencia del freno: quien ya tiene un evento oportunidad_frenada
			// no vuelve, igual que hace la store real (el dedup de events_dedup()
			// es de 2h, no alcanza contra un cron diario).
			const yaFrenados = new Set(
				store.events
					.filter(
						(e) =>
							e.tenant_id === tenantId &&
							e.type === "oportunidad_frenada" &&
							e.contact_key,
					)
					.map((e) => e.contact_key as string),
			);
			// La definición de "agotado" es la misma función que usa la store real:
			// isNoResponse(). Una sola regla, no una copia.
			return store.contacts.filter(
				(c) =>
					c.tenantId === tenantId &&
					isNoResponse({
						touches: c.touches,
						firstTouchAt: c.firstTouchAt ? new Date(c.firstTouchAt) : null,
						repliedAt: c.repliedAt ? new Date(c.repliedAt) : null,
						now,
					}) &&
					!yaFrenados.has(c.contactKey),
			);
		},

		async listKnownInboundIds(tenantId, contactKey) {
			const ids: string[] = [];
			for (const event of store.events) {
				if (
					event.tenant_id === tenantId &&
					event.contact_key === contactKey &&
					(event.type === "respuesta" || event.type === "rebote")
				) {
					const payload = event.payload as Record<string, unknown> | null;
					const msgId = payload?.gmail_message_id;
					if (typeof msgId === "string") ids.push(msgId);
				}
			}
			return ids;
		},

		async listPendingReplies(tenantId): Promise<PendingReply[]> {
			const byKey = new Map(
				store.contacts
					.filter(
						(c) => c.tenantId === tenantId && c.stage === "respuesta_neutra",
					)
					.map((c) => [c.contactKey, c]),
			);
			const result: PendingReply[] = [];
			for (const event of store.events) {
				if (event.tenant_id !== tenantId || event.type !== "respuesta")
					continue;
				const contact = event.contact_key ? byKey.get(event.contact_key) : null;
				if (!contact) continue;
				result.push({
					contactKey: contact.contactKey,
					name: contact.name,
					company: contact.company,
					text: event.summary,
					occurredAt: eventCreatedAt.get(event) ?? new Date(0).toISOString(),
				});
			}
			return result;
		},

		async countRecentReplies(tenantId, since) {
			const enRespuestaNeutra = new Set(
				store.contacts
					.filter(
						(c) => c.tenantId === tenantId && c.stage === "respuesta_neutra",
					)
					.map((c) => c.contactKey),
			);
			const contadas = new Set<string>();
			for (const event of store.events) {
				if (event.tenant_id !== tenantId || event.type !== "respuesta")
					continue;
				if (!event.contact_key || !enRespuestaNeutra.has(event.contact_key))
					continue;
				const createdAt = eventCreatedAt.get(event);
				if (!createdAt || new Date(createdAt) < since) continue;
				contadas.add(event.contact_key);
			}
			return contadas.size;
		},

		async countStalled(tenantId, since) {
			let count = 0;
			for (const event of store.events) {
				if (
					event.tenant_id !== tenantId ||
					event.type !== "oportunidad_frenada"
				)
					continue;
				const createdAt = eventCreatedAt.get(event);
				if (!createdAt || new Date(createdAt) < since) continue;
				count++;
			}
			return count;
		},

		async listActiveFocuses(tenantId) {
			return store.focuses.filter(
				(f) => f.tenantId === tenantId && f.status === "activo",
			);
		},

		async loadFocus(tenantId, id) {
			return (
				store.focuses.find((f) => f.tenantId === tenantId && f.id === id) ??
				null
			);
		},

		async updateFocus(tenantId, id, patch) {
			const focus = store.focuses.find(
				(f) => f.tenantId === tenantId && f.id === id,
			);
			if (!focus) throw new Error(`foco ${id} inexistente`);
			Object.assign(
				focus,
				Object.fromEntries(
					Object.entries(patch).filter(([, v]) => v !== undefined),
				),
			);
		},

		async upsertDiscoveredAccount(row) {
			// Igual que la store real: una cuenta existente no pierde su ficha ni
			// su expires_at, solo se refrescan los firmográficos.
			const existing = store.accounts.find(
				(a) => a.tenantId === row.tenantId && a.domain === row.domain,
			);
			if (existing) {
				existing.name = row.name;
				existing.firmographics = row.firmographics;
				existing.externalIds = row.externalIds;
				return { id: existing.id };
			}
			const now = new Date().toISOString();
			const account: AccountRow = {
				id: nextId("account"),
				tenantId: row.tenantId,
				domain: row.domain,
				name: row.name,
				ficha: {} as Ficha,
				researchedAt: now,
				expiresAt: now,
				firmographics: row.firmographics,
				externalIds: row.externalIds,
			};
			store.accounts.push(account);
			return { id: account.id };
		},

		async insertDiscoveredContact(row) {
			const existing = store.contacts.find(
				(c) => c.tenantId === row.tenantId && c.contactKey === row.contactKey,
			);
			if (existing) return "duplicado";
			const contact = contactRow({
				id: nextId("contact"),
				tenantId: row.tenantId,
				contactKey: row.contactKey,
				accountId: row.accountId,
				name: row.name,
				company: row.company,
				email: null,
				linkedinSlug: row.linkedinSlug,
				ownerUserId: row.ownerUserId,
				segment: row.segment,
				vector: row.vector,
				hook: row.hook,
				idioma: row.idioma,
				source: "apollo",
			});
			store.contacts.push(contact);
			return { id: contact.id };
		},

		contactSeed(): ContactRow {
			return contactRow();
		},
	};
	return store;
}
