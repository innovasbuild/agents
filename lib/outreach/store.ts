// Acceso a datos de outreach con el cliente admin (spec 03 §4). El tenant llega
// siempre de la sesión o del schedule, nunca del modelo. Los servicios dependen
// de la interfaz; los tests usan tests/outreach/fake-store.ts.
import type { SupabaseClient } from "@supabase/supabase-js";
import {
	type ConfigValueKind,
	type OutreachConfig,
	parseOutreachConfig,
} from "./config";
import type { OutreachEventInsert } from "./events";
import type { Ficha } from "./ficha";
import type { GateResult } from "./gate";
import type { OutreachStage } from "./stage";

export type QueueItemStatus =
	| "pending"
	| "approved"
	| "rejected"
	| "sent"
	| "failed"
	| "expired";
export type QueueItemKind = "msg1" | "followup_2" | "followup_3";

export interface Ancla {
	hecho: string;
	fuente: string;
}

export interface ExecutorRow {
	tenantId: string;
	userId: string;
	slug: string | null;
	crmOwnerId: string | null;
	dailyQuota: number;
	gmailAuthorizedAt: string | null;
	gmailReadAuthorizedAt: string | null;
}

export interface TenantOutreach {
	config: OutreachConfig;
	values: Record<ConfigValueKind, string[]>;
	defaultHooks: Record<string, string | null>;
}

export interface ContactRow {
	id: string;
	tenantId: string;
	contactKey: string;
	accountId: string | null;
	name: string | null;
	company: string | null;
	email: string | null;
	linkedinSlug: string | null;
	crmId: string | null;
	ownerUserId: string | null;
	segment: string | null;
	vector: string | null;
	hook: string | null;
	idioma: string | null;
	stage: OutreachStage;
	touches: number;
	firstTouchAt: string | null;
	lastTouchAt: string | null;
	nextStepAt: string | null;
	repliedAt: string | null;
	gmailThreadId: string | null;
	source: "csv" | "chat";
}

export type NewContact = Pick<
	ContactRow,
	| "tenantId"
	| "contactKey"
	| "accountId"
	| "name"
	| "company"
	| "email"
	| "linkedinSlug"
	| "crmId"
	| "segment"
	| "vector"
	| "source"
>;

export type ContactPatch = Partial<
	Pick<
		ContactRow,
		| "accountId"
		| "crmId"
		| "ownerUserId"
		| "segment"
		| "vector"
		| "hook"
		| "idioma"
		| "stage"
		| "touches"
		| "firstTouchAt"
		| "lastTouchAt"
		| "nextStepAt"
		| "repliedAt"
		| "gmailThreadId"
	>
>;

export interface AccountRow {
	id: string;
	tenantId: string;
	domain: string;
	name: string;
	ficha: Ficha;
	researchedAt: string;
	expiresAt: string;
}

export interface QueueItemRow {
	id: string;
	tenantId: string;
	contactId: string;
	contactKey: string;
	executorUserId: string;
	kind: QueueItemKind;
	toEmail: string;
	subject: string;
	body: string;
	hook: string;
	vector: string;
	idioma: string;
	ancla: Ancla | null;
	draftOriginal: { subject: string; body: string };
	gateResult: GateResult;
	status: QueueItemStatus;
	expiresAt: string;
	replyToMessageId: string | null;
	gmailThreadId: string | null;
	gmailMessageId: string | null;
	approvedAt: string | null;
	sentAt: string | null;
	error: string | null;
	eveSessionId: string | null;
	approvalCallId: string | null;
	createdAt: string;
}

export type NewQueueItem = Pick<
	QueueItemRow,
	| "tenantId"
	| "contactId"
	| "contactKey"
	| "executorUserId"
	| "kind"
	| "toEmail"
	| "subject"
	| "body"
	| "hook"
	| "vector"
	| "idioma"
	| "ancla"
	| "draftOriginal"
	| "gateResult"
	| "replyToMessageId"
	| "gmailThreadId"
>;

export type QueueItemPatch = Partial<
	Pick<
		QueueItemRow,
		| "subject"
		| "body"
		| "gateResult"
		| "status"
		| "gmailMessageId"
		| "gmailThreadId"
		| "approvedAt"
		| "sentAt"
		| "error"
		| "eveSessionId"
		| "approvalCallId"
	>
>;

export interface SentFilter {
	since: Date;
	executorUserId?: string;
	toEmail?: string;
	excludeThreadId?: string | null;
}

export interface OutreachStore {
	loadExecutor(tenantId: string, userId: string): Promise<ExecutorRow | null>;
	loadTenantOutreach(tenantId: string): Promise<TenantOutreach | null>;
	findContactsByKeys(
		tenantId: string,
		keys: readonly string[],
	): Promise<ContactRow[]>;
	insertContact(row: NewContact): Promise<ContactRow>;
	updateContact(
		tenantId: string,
		id: string,
		patch: ContactPatch,
	): Promise<ContactRow>;
	findAccount(tenantId: string, domain: string): Promise<AccountRow | null>;
	upsertAccount(row: Omit<AccountRow, "id">): Promise<AccountRow>;
	/** "pieza_viva" si la persona ya tiene una pieza pending o approved. */
	insertQueueItem(row: NewQueueItem): Promise<QueueItemRow | "pieza_viva">;
	getQueueItem(tenantId: string, id: string): Promise<QueueItemRow | null>;
	listQueue(
		tenantId: string,
		executorUserId: string,
		statuses: readonly QueueItemStatus[],
	): Promise<QueueItemRow[]>;
	/** Update condicional: solo si la fila sigue en `from`. null si no. */
	transitionQueueItem(
		tenantId: string,
		id: string,
		from: QueueItemStatus,
		patch: QueueItemPatch,
	): Promise<QueueItemRow | null>;
	/** Piezas `sent` desde `since`, con filtros. */
	countSent(
		tenantId: string,
		filter: SentFilter,
	): Promise<{ count: number; lastSentAt: Date | null }>;
	/** Un insert descartado por el dedup (0 filas) o un 23505 cuentan como ya registrado. */
	insertEvents(rows: readonly OutreachEventInsert[]): Promise<void>;
	/** Tenants activos del sistema. */
	listActiveTenants(): Promise<{ id: string; slug: string }[]>;
	/** Ejecutores del tenant con Gmail autorizado. */
	listExecutorsWithGmailRead(tenantId: string): Promise<ExecutorRow[]>;
	/** Contactos del tenant con hilo de Gmail asignado a un ejecutor específico. */
	listContactsWithThread(
		tenantId: string,
		ownerUserId: string,
	): Promise<ContactRow[]>;
	/** Contactos vencidos para seguimiento (no respondidos, < 3 toques). */
	listDueFollowups(tenantId: string, now: Date): Promise<ContactRow[]>;
	/** IDs de mensaje Gmail conocidos en eventos de respuesta/rebote. */
	listKnownInboundIds(tenantId: string, contactKey: string): Promise<string[]>;
	/** Eventos de respuesta, sin interpretar, de contactos que siguen en
	 * `respuesta_neutra` (Task 8: revisión humana de escucha). */
	listPendingReplies(tenantId: string): Promise<PendingReply[]>;
}

export interface PendingReply {
	contactKey: string;
	name: string | null;
	company: string | null;
	text: string;
	occurredAt: string;
}

const CONTACT_COLUMNS =
	"id, tenant_id, contact_key, account_id, name, company, email, linkedin_slug, crm_id, owner_user_id, segment, vector, hook, idioma, stage, touches, first_touch_at, last_touch_at, next_step_at, replied_at, gmail_thread_id, source";
const QUEUE_COLUMNS =
	"id, tenant_id, contact_id, contact_key, executor_user_id, kind, to_email, subject, body, hook, vector, idioma, ancla, draft_original, gate_result, status, expires_at, reply_to_message_id, gmail_thread_id, gmail_message_id, approved_at, sent_at, error, eve_session_id, approval_call_id, created_at";

type Row = Record<string, unknown>;

const toContact = (r: Row): ContactRow => ({
	id: r.id as string,
	tenantId: r.tenant_id as string,
	contactKey: r.contact_key as string,
	accountId: (r.account_id as string | null) ?? null,
	name: (r.name as string | null) ?? null,
	company: (r.company as string | null) ?? null,
	email: (r.email as string | null) ?? null,
	linkedinSlug: (r.linkedin_slug as string | null) ?? null,
	crmId: (r.crm_id as string | null) ?? null,
	ownerUserId: (r.owner_user_id as string | null) ?? null,
	segment: (r.segment as string | null) ?? null,
	vector: (r.vector as string | null) ?? null,
	hook: (r.hook as string | null) ?? null,
	idioma: (r.idioma as string | null) ?? null,
	stage: r.stage as OutreachStage,
	touches: r.touches as number,
	firstTouchAt: (r.first_touch_at as string | null) ?? null,
	lastTouchAt: (r.last_touch_at as string | null) ?? null,
	nextStepAt: (r.next_step_at as string | null) ?? null,
	repliedAt: (r.replied_at as string | null) ?? null,
	gmailThreadId: (r.gmail_thread_id as string | null) ?? null,
	source: r.source as "csv" | "chat",
});

const toQueueItem = (r: Row): QueueItemRow => ({
	id: r.id as string,
	tenantId: r.tenant_id as string,
	contactId: r.contact_id as string,
	contactKey: r.contact_key as string,
	executorUserId: r.executor_user_id as string,
	kind: r.kind as QueueItemKind,
	toEmail: r.to_email as string,
	subject: r.subject as string,
	body: r.body as string,
	hook: r.hook as string,
	vector: r.vector as string,
	idioma: r.idioma as string,
	ancla: (r.ancla as Ancla | null) ?? null,
	draftOriginal: r.draft_original as { subject: string; body: string },
	gateResult: r.gate_result as GateResult,
	status: r.status as QueueItemStatus,
	expiresAt: r.expires_at as string,
	replyToMessageId: (r.reply_to_message_id as string | null) ?? null,
	gmailThreadId: (r.gmail_thread_id as string | null) ?? null,
	gmailMessageId: (r.gmail_message_id as string | null) ?? null,
	approvedAt: (r.approved_at as string | null) ?? null,
	sentAt: (r.sent_at as string | null) ?? null,
	error: (r.error as string | null) ?? null,
	eveSessionId: (r.eve_session_id as string | null) ?? null,
	approvalCallId: (r.approval_call_id as string | null) ?? null,
	createdAt: r.created_at as string,
});

const toAccount = (r: Row): AccountRow => ({
	id: r.id as string,
	tenantId: r.tenant_id as string,
	domain: r.domain as string,
	name: r.name as string,
	ficha: r.ficha as Ficha,
	researchedAt: r.researched_at as string,
	expiresAt: r.expires_at as string,
});

const CONTACT_PATCH_COLUMNS: Record<keyof ContactPatch, string> = {
	accountId: "account_id",
	crmId: "crm_id",
	ownerUserId: "owner_user_id",
	segment: "segment",
	vector: "vector",
	hook: "hook",
	idioma: "idioma",
	stage: "stage",
	touches: "touches",
	firstTouchAt: "first_touch_at",
	lastTouchAt: "last_touch_at",
	nextStepAt: "next_step_at",
	repliedAt: "replied_at",
	gmailThreadId: "gmail_thread_id",
};

const QUEUE_PATCH_COLUMNS: Record<keyof QueueItemPatch, string> = {
	subject: "subject",
	body: "body",
	gateResult: "gate_result",
	status: "status",
	gmailMessageId: "gmail_message_id",
	gmailThreadId: "gmail_thread_id",
	approvedAt: "approved_at",
	sentAt: "sent_at",
	error: "error",
	eveSessionId: "eve_session_id",
	approvalCallId: "approval_call_id",
};

function toColumns<T extends object>(
	patch: T,
	map: Record<keyof T, string>,
): Row {
	const out: Row = {};
	for (const [key, value] of Object.entries(patch)) {
		if (value !== undefined) out[map[key as keyof T]] = value;
	}
	return out;
}

function fail(what: string, error: { message: string } | null): never {
	throw new Error(`no pude ${what}: ${error?.message ?? "sin fila"}`);
}

export function createSupabaseOutreachStore(
	client: SupabaseClient,
): OutreachStore {
	return {
		async loadExecutor(tenantId, userId) {
			const { data, error } = await client
				.from("executors")
				.select(
					"tenant_id, user_id, slug, crm_owner_id, daily_quota, gmail_authorized_at, gmail_read_authorized_at",
				)
				.eq("tenant_id", tenantId)
				.eq("user_id", userId)
				.maybeSingle();
			if (error) fail("leer el ejecutor", error);
			if (!data) return null;
			return {
				tenantId: data.tenant_id,
				userId: data.user_id,
				slug: data.slug ?? null,
				crmOwnerId: data.crm_owner_id ?? null,
				dailyQuota: data.daily_quota,
				gmailAuthorizedAt: data.gmail_authorized_at ?? null,
				gmailReadAuthorizedAt: data.gmail_read_authorized_at ?? null,
			};
		},

		async loadTenantOutreach(tenantId) {
			const { data: agent, error } = await client
				.from("tenant_agents")
				.select("config")
				.eq("tenant_id", tenantId)
				.eq("agent", "outreach")
				.eq("enabled", true)
				.maybeSingle();
			if (error) fail("leer tenant_agents", error);
			if (!agent) return null;
			const { data: rows, error: valuesError } = await client
				.from("config_values")
				.select("kind, value, meta")
				.eq("tenant_id", tenantId)
				.eq("active", true);
			if (valuesError) fail("leer config_values", valuesError);
			const values: Record<ConfigValueKind, string[]> = {
				segmento: [],
				vector: [],
				hook: [],
				idioma: [],
			};
			const defaultHooks: Record<string, string | null> = {};
			for (const row of rows ?? []) {
				const kind = row.kind as ConfigValueKind;
				values[kind].push(row.value as string);
				if (kind === "vector") {
					const hook = (row.meta as { default_hook?: unknown } | null)
						?.default_hook;
					defaultHooks[row.value as string] =
						typeof hook === "string" ? hook : null;
				}
			}
			const config = parseOutreachConfig(
				(agent.config as { outreach?: unknown } | null)?.outreach,
			);
			return { config, values, defaultHooks };
		},

		async findContactsByKeys(tenantId, keys) {
			if (keys.length === 0) return [];
			const { data, error } = await client
				.from("contacts")
				.select(CONTACT_COLUMNS)
				.eq("tenant_id", tenantId)
				.in("contact_key", [...keys]);
			if (error) fail("leer contactos", error);
			return (data ?? []).map(toContact);
		},

		async insertContact(row) {
			const { data, error } = await client
				.from("contacts")
				.insert({
					tenant_id: row.tenantId,
					contact_key: row.contactKey,
					account_id: row.accountId,
					name: row.name,
					company: row.company,
					email: row.email,
					linkedin_slug: row.linkedinSlug,
					crm_id: row.crmId,
					segment: row.segment,
					vector: row.vector,
					source: row.source,
				})
				.select(CONTACT_COLUMNS)
				.single();
			if (error || !data) fail("crear el contacto", error);
			return toContact(data);
		},

		async updateContact(tenantId, id, patch) {
			const { data, error } = await client
				.from("contacts")
				.update({
					...toColumns(patch, CONTACT_PATCH_COLUMNS),
					updated_at: new Date().toISOString(),
				})
				.eq("tenant_id", tenantId)
				.eq("id", id)
				.select(CONTACT_COLUMNS)
				.single();
			if (error || !data) fail("actualizar el contacto", error);
			return toContact(data);
		},

		async findAccount(tenantId, domain) {
			const { data, error } = await client
				.from("accounts")
				.select("id, tenant_id, domain, name, ficha, researched_at, expires_at")
				.eq("tenant_id", tenantId)
				.eq("domain", domain)
				.maybeSingle();
			if (error) fail("leer la cuenta", error);
			return data ? toAccount(data) : null;
		},

		async upsertAccount(row) {
			const { data, error } = await client
				.from("accounts")
				.upsert(
					{
						tenant_id: row.tenantId,
						domain: row.domain,
						name: row.name,
						ficha: row.ficha,
						researched_at: row.researchedAt,
						expires_at: row.expiresAt,
					},
					{ onConflict: "tenant_id,domain" },
				)
				.select("id, tenant_id, domain, name, ficha, researched_at, expires_at")
				.single();
			if (error || !data) fail("guardar la cuenta", error);
			return toAccount(data);
		},

		async insertQueueItem(row) {
			const { data, error } = await client
				.from("queue_items")
				.insert({
					tenant_id: row.tenantId,
					contact_id: row.contactId,
					contact_key: row.contactKey,
					executor_user_id: row.executorUserId,
					kind: row.kind,
					to_email: row.toEmail,
					subject: row.subject,
					body: row.body,
					hook: row.hook,
					vector: row.vector,
					idioma: row.idioma,
					ancla: row.ancla,
					draft_original: row.draftOriginal,
					gate_result: row.gateResult,
					reply_to_message_id: row.replyToMessageId,
					gmail_thread_id: row.gmailThreadId,
				})
				.select(QUEUE_COLUMNS)
				.single();
			if (error?.code === "23505") return "pieza_viva";
			if (error || !data) fail("encolar la pieza", error);
			return toQueueItem(data);
		},

		async getQueueItem(tenantId, id) {
			const { data, error } = await client
				.from("queue_items")
				.select(QUEUE_COLUMNS)
				.eq("tenant_id", tenantId)
				.eq("id", id)
				.maybeSingle();
			if (error) fail("leer la pieza", error);
			return data ? toQueueItem(data) : null;
		},

		async listQueue(tenantId, executorUserId, statuses) {
			const { data, error } = await client
				.from("queue_items")
				.select(QUEUE_COLUMNS)
				.eq("tenant_id", tenantId)
				.eq("executor_user_id", executorUserId)
				.in("status", [...statuses])
				.order("created_at", { ascending: true });
			if (error) fail("leer la cola", error);
			return (data ?? []).map(toQueueItem);
		},

		async transitionQueueItem(tenantId, id, from, patch) {
			const { data, error } = await client
				.from("queue_items")
				.update({
					...toColumns(patch, QUEUE_PATCH_COLUMNS),
					updated_at: new Date().toISOString(),
				})
				.eq("tenant_id", tenantId)
				.eq("id", id)
				.eq("status", from)
				.select(QUEUE_COLUMNS)
				.maybeSingle();
			if (error) fail("actualizar la pieza", error);
			return data ? toQueueItem(data) : null;
		},

		async countSent(tenantId, filter) {
			let query = client
				.from("queue_items")
				.select("sent_at, gmail_thread_id")
				.eq("tenant_id", tenantId)
				.eq("status", "sent")
				.gte("sent_at", filter.since.toISOString());
			if (filter.executorUserId)
				query = query.eq("executor_user_id", filter.executorUserId);
			if (filter.toEmail) query = query.eq("to_email", filter.toEmail);
			const { data, error } = await query.order("sent_at", {
				ascending: false,
			});
			if (error) fail("contar envíos", error);
			const rows = (data ?? []).filter(
				(row) =>
					!filter.excludeThreadId ||
					row.gmail_thread_id !== filter.excludeThreadId,
			);
			return {
				count: rows.length,
				lastSentAt: rows[0]?.sent_at ? new Date(rows[0].sent_at) : null,
			};
		},

		async insertEvents(rows) {
			for (const row of rows) {
				const { error } = await client.from("events").insert(row);
				if (error && error.code !== "23505")
					fail(`registrar el evento ${row.type}`, error);
			}
		},

		async listActiveTenants() {
			const { data, error } = await client
				.from("tenants")
				.select("id, slug")
				.eq("active", true);
			if (error) fail("listar tenants activos", error);
			return (data ?? []).map((r) => ({
				id: r.id as string,
				slug: r.slug as string,
			}));
		},

		async listExecutorsWithGmailRead(tenantId) {
			const { data, error } = await client
				.from("executors")
				.select(
					"tenant_id, user_id, slug, crm_owner_id, daily_quota, gmail_authorized_at, gmail_read_authorized_at",
				)
				.eq("tenant_id", tenantId)
				.not("gmail_read_authorized_at", "is", null);
			if (error) fail("listar ejecutores con Gmail", error);
			return (data ?? []).map((r) => ({
				tenantId: r.tenant_id,
				userId: r.user_id,
				slug: r.slug ?? null,
				crmOwnerId: r.crm_owner_id ?? null,
				dailyQuota: r.daily_quota,
				gmailAuthorizedAt: r.gmail_authorized_at ?? null,
				gmailReadAuthorizedAt: r.gmail_read_authorized_at ?? null,
			}));
		},

		async listContactsWithThread(tenantId, ownerUserId) {
			const { data, error } = await client
				.from("contacts")
				.select(CONTACT_COLUMNS)
				.eq("tenant_id", tenantId)
				.eq("owner_user_id", ownerUserId)
				.not("gmail_thread_id", "is", null);
			if (error) fail("listar contactos con hilo", error);
			return (data ?? []).map(toContact);
		},

		async listDueFollowups(tenantId, now) {
			const { data, error } = await client
				.from("contacts")
				.select(CONTACT_COLUMNS)
				.eq("tenant_id", tenantId)
				.lte("next_step_at", now.toISOString())
				.lt("touches", 3)
				.is("replied_at", null);
			if (error) fail("listar seguimientos vencidos", error);
			return (data ?? []).map(toContact);
		},

		async listKnownInboundIds(tenantId, contactKey) {
			const { data, error } = await client
				.from("events")
				.select("payload")
				.eq("tenant_id", tenantId)
				.eq("contact_key", contactKey)
				.in("type", ["respuesta", "rebote"]);
			if (error) fail("listar IDs de rebote/respuesta", error);
			const ids: string[] = [];
			for (const row of data ?? []) {
				const payload = row.payload as Record<string, unknown> | null;
				const msgId = payload?.gmail_message_id;
				if (typeof msgId === "string") ids.push(msgId);
			}
			return ids;
		},

		async listPendingReplies(tenantId) {
			const { data: contacts, error: contactsError } = await client
				.from("contacts")
				.select("contact_key, name, company")
				.eq("tenant_id", tenantId)
				.eq("stage", "respuesta_neutra");
			if (contactsError)
				fail("listar contactos en respuesta_neutra", contactsError);
			const pending = contacts ?? [];
			if (pending.length === 0) return [];
			const byKey = new Map(
				pending.map((c) => [
					c.contact_key as string,
					{
						name: (c.name as string | null) ?? null,
						company: (c.company as string | null) ?? null,
					},
				]),
			);

			const { data: events, error: eventsError } = await client
				.from("events")
				.select("contact_key, summary, created_at")
				.eq("tenant_id", tenantId)
				.eq("type", "respuesta")
				.in("contact_key", Array.from(byKey.keys()))
				.order("created_at", { ascending: true });
			if (eventsError) fail("listar eventos de respuesta", eventsError);

			const result: PendingReply[] = [];
			for (const row of events ?? []) {
				const contactKey = row.contact_key as string | null;
				if (!contactKey) continue;
				const contact = byKey.get(contactKey);
				if (!contact) continue;
				result.push({
					contactKey,
					name: contact.name,
					company: contact.company,
					text: (row.summary as string | null) ?? "",
					occurredAt: row.created_at as string,
				});
			}
			return result;
		},
	};
}
