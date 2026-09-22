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
import { type Ficha, fichaSchema } from "./ficha";
import type { GateResult } from "./gate";
import type { IcpLane } from "./icp";
import type { JevNoul, JevScore } from "./services/evaluate";
import {
	isNoResponse,
	MAX_TOUCHES,
	NO_RESPONSE_AFTER_DAYS,
	type OutreachStage,
} from "./stage";

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
	/** Etiqueta legible de cada valor, para mostrar en vez del slug (spec 03 §4.3). */
	labels: Record<ConfigValueKind, Record<string, string>>;
	defaultHooks: Record<string, string | null>;
}

/** El resultado crudo del scoring de ICP, guardado en contacts.icp (spec
 * etapa 13 §7.3). `revision` es la de los niveles del tenant en el momento en
 * que se calificó: cambiarla en la config no recalifica sola, solo marca a
 * quién le toca de nuevo. */
export interface ContactIcp {
	encaje_empresa: JevScore | null;
	rol_decisor: JevScore | null;
	excluir: JevNoul | null;
	lane: IcpLane;
	reason: string;
	model: string;
	revision: string;
	judged_at: string;
}

export interface ContactRow {
	id: string;
	tenantId: string;
	contactKey: string;
	accountId: string | null;
	name: string | null;
	company: string | null;
	title: string | null;
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
	source: "csv" | "chat" | "apollo";
	icp: ContactIcp | null;
	/** IDs del proveedor de origen (Apollo, etc.), `{}` si no vino de uno. Lo
	 * usa reveal-email para saber a quién pedirle el email. */
	externalIds: Record<string, unknown>;
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
	/** Firmográficos de Apollo (spec etapa 13 §6). Ausentes en las lecturas de
	 * research; el fake de tests los usa para espejar upsertDiscoveredAccount. */
	firmographics?: Record<string, unknown>;
	externalIds?: Record<string, unknown>;
}

/** Lo que el sembrador de refresh-fichas necesita de una cuenta: sin la ficha. */
export interface RefreshCandidate {
	id: string;
	domain: string;
	name: string;
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
	findContactById(tenantId: string, id: string): Promise<ContactRow | null>;
	insertContact(row: NewContact): Promise<ContactRow>;
	updateContact(
		tenantId: string,
		id: string,
		patch: ContactPatch,
	): Promise<ContactRow>;
	/** Pisa contacts.icp entero: es un juicio nuevo, no un patch parcial (spec
	 * etapa 13 §7.3). */
	updateContactIcp(
		tenantId: string,
		id: string,
		icp: ContactIcp,
	): Promise<void>;
	findAccount(tenantId: string, domain: string): Promise<AccountRow | null>;
	upsertAccount(row: Omit<AccountRow, "id">): Promise<AccountRow>;
	findAccountById(tenantId: string, id: string): Promise<AccountRow | null>;
	/** Cuentas vencidas a `now` que refresh-fichas todavía no encoló desde su
	 * último research (función refresh_fichas_candidates), de la más vieja a la
	 * más nueva. */
	listAccountsToRefresh(
		tenantId: string,
		now: Date,
		limit: number,
	): Promise<RefreshCandidate[]>;
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
	/** Piezas de HOY (cualquier estado, no solo `sent`: lo que importa acá es
	 * cuánto se le SUMÓ a la cola hoy, no cuánto salió) encoladas por este
	 * ejecutor. Gatea draft-queue, no el envío (eso ya lo hace countSent). */
	countQueuedToday(
		tenantId: string,
		executorUserId: string,
		since: Date,
	): Promise<number>;
	/** Contactos `contacto_listo` (email revelado, calificado, sin primer
	 * toque todavía y sin una pieza pending/approved ya encolada) elegibles
	 * para draft-queue hoy: el sembrador de reintento diario (D17). */
	listContactsReadyToDraft(
		tenantId: string,
		now: Date,
	): Promise<{ contactId: string; contactKey: string }[]>;
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
	/** Contactos agotados (Task 10): touches >= 3, sin respuesta, y su primer
	 * toque más viejo que NO_RESPONSE_AFTER_DAYS. Es el universo sobre el que
	 * corre el freno de oportunidades (`oportunidad_frenada`), no el de los
	 * follow-ups: esos ya se cortaron. */
	listExhaustedContacts(tenantId: string, now: Date): Promise<ContactRow[]>;
	/** IDs de mensaje Gmail conocidos en eventos de respuesta/rebote. */
	listKnownInboundIds(tenantId: string, contactKey: string): Promise<string[]>;
	/** Eventos de respuesta, sin interpretar, de contactos que siguen en
	 * `respuesta_neutra` (Task 8: revisión humana de escucha). */
	listPendingReplies(tenantId: string): Promise<PendingReply[]>;
	/** Contactos en `respuesta_neutra` con evento `respuesta` desde `since`
	 * (resumen de sesión: Task 11). */
	countRecentReplies(tenantId: string, since: Date): Promise<number>;
	/** Eventos `oportunidad_frenada` desde `since` (resumen de sesión:
	 * Task 11). */
	countStalled(tenantId: string, since: Date): Promise<number>;
	/** Focos activos del tenant, para el sembrador de target-search. */
	listActiveFocuses(tenantId: string): Promise<FocusRow[]>;
	loadFocus(tenantId: string, id: string): Promise<FocusRow | null>;
	updateFocus(
		tenantId: string,
		id: string,
		patch: Partial<
			Pick<FocusRow, "status" | "accountsFound" | "contactsFound">
		>,
	): Promise<void>;
	/** Cuenta descubierta: no pisa la ficha de research si ya existe. */
	upsertDiscoveredAccount(row: {
		tenantId: string;
		domain: string;
		name: string;
		firmographics: Record<string, unknown>;
		externalIds: Record<string, unknown>;
	}): Promise<{ id: string }>;
	/** "duplicado" si ese contact_key ya existe en el tenant. */
	insertDiscoveredContact(row: {
		tenantId: string;
		contactKey: string;
		accountId: string | null;
		ownerUserId: string;
		searchFocusId: string;
		name: string;
		company: string;
		title: string | null;
		linkedinSlug: string | null;
		segment: string;
		vector: string;
		hook: string;
		idioma: string;
		externalIds: Record<string, unknown>;
	}): Promise<{ id: string } | "duplicado">;
	/** El invariante que hace segura la promoción (§6.3): un contacto con
	 * eventos o piezas ya tiene su clave congelada. */
	hasContactBeenTouched(tenantId: string, contactKey: string): Promise<boolean>;
	/** UPDATE optimista guardado por la clave vieja: si otra promoción ganó la
	 * carrera, `oldKey` ya no matchea y da 0 filas, no un 23505 — por eso
	 * ADEMÁS se chequea el 23505 de la clave nueva, que es el caso real de
	 * "esa persona ya existía". */
	promoteContactKey(
		tenantId: string,
		id: string,
		patch: { oldKey: string; newKey: string; email: string },
	): Promise<"promovido" | "duplicado" | "carrera_perdida">;
	/** Todos los focos del tenant, cualquier status (para /focos, a diferencia
	 * de listActiveFocuses que usa el sembrador de target-search). */
	listFocuses(tenantId: string): Promise<FocusRow[]>;
	insertFocus(
		row: Omit<FocusRow, "id" | "accountsFound" | "contactsFound" | "status">,
	): Promise<FocusRow>;
	funnelForFocus(tenantId: string, focusId: string): Promise<FocusFunnel>;
}

export interface FocusFunnel {
	descubiertos: number;
	calificados: number;
	descartados: number;
	paraRevisar: number;
	enriquecidos: number;
	encolados: number;
	enviados: number;
}

export interface PendingReply {
	contactKey: string;
	name: string | null;
	company: string | null;
	text: string;
	occurredAt: string;
}

export interface FocusRow {
	id: string;
	tenantId: string;
	createdBy: string;
	name: string;
	criteria: Record<string, unknown>;
	vector: string;
	segment: string;
	hook: string;
	idioma: string;
	maxAccounts: number;
	maxContacts: number;
	status: "activo" | "agotado" | "cancelado";
	accountsFound: number;
	contactsFound: number;
}

const CONTACT_COLUMNS =
	"id, tenant_id, contact_key, account_id, name, company, title, email, linkedin_slug, crm_id, owner_user_id, segment, vector, hook, idioma, stage, touches, first_touch_at, last_touch_at, next_step_at, replied_at, gmail_thread_id, source, icp, external_ids";
const QUEUE_COLUMNS =
	"id, tenant_id, contact_id, contact_key, executor_user_id, kind, to_email, subject, body, hook, vector, idioma, ancla, draft_original, gate_result, status, expires_at, reply_to_message_id, gmail_thread_id, gmail_message_id, approved_at, sent_at, error, eve_session_id, approval_call_id, created_at";
const FOCUS_COLUMNS =
	"id, tenant_id, created_by, name, criteria, vector, segment, hook, idioma, max_accounts, max_contacts, status, accounts_found, contacts_found";

type Row = Record<string, unknown>;

const toContact = (r: Row): ContactRow => ({
	id: r.id as string,
	tenantId: r.tenant_id as string,
	contactKey: r.contact_key as string,
	accountId: (r.account_id as string | null) ?? null,
	name: (r.name as string | null) ?? null,
	company: (r.company as string | null) ?? null,
	title: (r.title as string | null) ?? null,
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
	// La columna es `not null default '{}'`: sin scoring todavía, esa fila vacía
	// vale como "no calificado", igual que null.
	icp:
		r.icp &&
		typeof r.icp === "object" &&
		Object.keys(r.icp as object).length > 0
			? (r.icp as ContactIcp)
			: null,
	externalIds: (r.external_ids as Record<string, unknown> | null) ?? {},
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
	// El parse completa `dolores` en fichas guardadas antes de que existiera;
	// una ficha que no parsea (la `{}` de una cuenta descubierta) pasa tal cual.
	ficha: fichaSchema.safeParse(r.ficha).data ?? (r.ficha as Ficha),
	researchedAt: r.researched_at as string,
	expiresAt: r.expires_at as string,
	// Solo viajan cuando el select las pide (findAccountById, para icp-score);
	// undefined en las lecturas del flujo de research, que no las necesita.
	firmographics: r.firmographics as Record<string, unknown> | undefined,
	externalIds: r.external_ids as Record<string, unknown> | undefined,
});

const toFocus = (r: Row): FocusRow => ({
	id: r.id as string,
	tenantId: r.tenant_id as string,
	createdBy: r.created_by as string,
	name: r.name as string,
	criteria: r.criteria as Record<string, unknown>,
	vector: r.vector as string,
	segment: r.segment as string,
	hook: r.hook as string,
	idioma: r.idioma as string,
	maxAccounts: r.max_accounts as number,
	maxContacts: r.max_contacts as number,
	status: r.status as FocusRow["status"],
	accountsFound: r.accounts_found as number,
	contactsFound: r.contacts_found as number,
});

const FOCUS_PATCH_COLUMNS: Record<
	keyof Pick<FocusRow, "status" | "accountsFound" | "contactsFound">,
	string
> = {
	status: "status",
	accountsFound: "accounts_found",
	contactsFound: "contacts_found",
};

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
				.select("kind, value, label, meta")
				.eq("tenant_id", tenantId)
				.eq("active", true);
			if (valuesError) fail("leer config_values", valuesError);
			const values: Record<ConfigValueKind, string[]> = {
				segmento: [],
				vector: [],
				hook: [],
				idioma: [],
			};
			const labels: Record<ConfigValueKind, Record<string, string>> = {
				segmento: {},
				vector: {},
				hook: {},
				idioma: {},
			};
			const defaultHooks: Record<string, string | null> = {};
			for (const row of rows ?? []) {
				const kind = row.kind as ConfigValueKind;
				values[kind].push(row.value as string);
				labels[kind][row.value as string] = row.label as string;
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
			return { config, values, labels, defaultHooks };
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

		async findContactById(tenantId, id) {
			const { data, error } = await client
				.from("contacts")
				.select(CONTACT_COLUMNS)
				.eq("tenant_id", tenantId)
				.eq("id", id)
				.maybeSingle();
			if (error) fail("leer el contacto", error);
			return data ? toContact(data) : null;
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

		async updateContactIcp(tenantId, id, icp) {
			const { error } = await client
				.from("contacts")
				.update({ icp, updated_at: new Date().toISOString() })
				.eq("tenant_id", tenantId)
				.eq("id", id);
			if (error) fail("guardar el ICP del contacto", error);
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

		async findAccountById(tenantId, id) {
			// A diferencia de findAccount/upsertAccount (flujo de research web),
			// icp-score necesita los firmográficos de Apollo para calificar.
			const { data, error } = await client
				.from("accounts")
				.select(
					"id, tenant_id, domain, name, ficha, researched_at, expires_at, firmographics, external_ids",
				)
				.eq("tenant_id", tenantId)
				.eq("id", id)
				.maybeSingle();
			if (error) fail("leer la cuenta", error);
			return data ? toAccount(data) : null;
		},

		async listAccountsToRefresh(tenantId, now, limit) {
			const { data, error } = await client.rpc("refresh_fichas_candidates", {
				p_tenant: tenantId,
				p_now: now.toISOString(),
				p_limit: limit,
			});
			if (error) fail("listar cuentas para refrescar", error);
			return ((data ?? []) as Row[]).map((r) => ({
				id: r.id as string,
				domain: r.domain as string,
				name: r.name as string,
				researchedAt: r.researched_at as string,
				expiresAt: r.expires_at as string,
			}));
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

		async countQueuedToday(tenantId, executorUserId, since) {
			const { count, error } = await client
				.from("queue_items")
				.select("id", { head: true, count: "exact" })
				.eq("tenant_id", tenantId)
				.eq("executor_user_id", executorUserId)
				.gte("created_at", since.toISOString());
			if (error) fail("contar piezas encoladas hoy", error);
			return count ?? 0;
		},

		async listContactsReadyToDraft(tenantId, _now) {
			// "listo": email revelado, calificado, todavía sin primer toque
			// (first_touch_at solo se estampa en el envío real, send.ts, nunca al
			// encolar) y, sumado acá, sin una pieza pending/approved ya esperando
			// el click humano en /cola — dos consultas y filtrado en memoria, como
			// funnelForFocus (Task 22), en vez de un join: sin eso, mientras la
			// pieza espera sus hasta 7 días (queue_items.expires_at) el seed()
			// diario la re-sembraba y gastaba un draftMessage + un verifyFact real
			// por gusto, antes de que insertQueueItem la frenara igual con
			// "pieza_viva".
			const { data, error } = await client
				.from("contacts")
				.select("id, contact_key, email")
				.eq("tenant_id", tenantId)
				.not("email", "is", null)
				.eq("icp->>lane", "calificado")
				.is("first_touch_at", null);
			if (error) fail("listar contactos listos para redactar", error);
			const candidates = data ?? [];
			if (candidates.length === 0) return [];

			const { data: live, error: liveError } = await client
				.from("queue_items")
				.select("contact_id")
				.eq("tenant_id", tenantId)
				.in("status", ["pending", "approved"]);
			if (liveError) fail("listar piezas vivas", liveError);
			const liveContactIds = new Set(
				(live ?? []).map((r) => r.contact_id as string),
			);

			return candidates
				.filter((r) => !liveContactIds.has(r.id as string))
				.map((r) => ({
					contactId: r.id as string,
					contactKey: r.contact_key as string,
				}));
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
				.not("gmail_thread_id", "is", null)
				// Orden estable: sin esto, dos corridas del barrido recorren los
				// contactos en órdenes distintos y un problema que afecte a algunos
				// no se ve como patrón en los logs.
				.order("contact_key", { ascending: true });
			if (error) fail("listar contactos con hilo", error);
			return (data ?? []).map(toContact);
		},

		async listDueFollowups(tenantId, now) {
			// Simetría con listContactsWithThread: el carril de follow-ups entra
			// por el mismo universo que el de la escucha. Sin grant de lectura
			// nadie está leyendo las respuestas de ese ejecutor, así que seguirle
			// encolando toques es mandar a ciegas — si no puedo escuchar, no sigo
			// tocando.
			const { data: readers, error: readersError } = await client
				.from("executors")
				.select("user_id")
				.eq("tenant_id", tenantId)
				.not("gmail_read_authorized_at", "is", null);
			if (readersError)
				fail("listar ejecutores con lectura de Gmail", readersError);
			const readerIds = (readers ?? []).map((r) => r.user_id as string);
			if (readerIds.length === 0) return [];

			const { data, error } = await client
				.from("contacts")
				.select(CONTACT_COLUMNS)
				.eq("tenant_id", tenantId)
				.in("owner_user_id", readerIds)
				.lte("next_step_at", now.toISOString())
				.lt("touches", 3)
				.is("replied_at", null);
			if (error) fail("listar seguimientos vencidos", error);
			return (data ?? []).map(toContact);
		},

		async listExhaustedContacts(tenantId, now) {
			// La definición de "agotado" es UNA: `isNoResponse()` (stage.ts). Este
			// SQL es solo un prefiltro para no traerse la tabla entera — por eso
			// `lte` y no `lt`, para no ser más estricto que la regla canónica en el
			// borde. La palabra final la tiene la función, abajo. Antes había dos
			// copias de la misma regla y solo una tenía test.
			const threshold = new Date(
				now.getTime() - NO_RESPONSE_AFTER_DAYS * 86_400_000,
			).toISOString();
			const { data, error } = await client
				.from("contacts")
				.select(CONTACT_COLUMNS)
				.eq("tenant_id", tenantId)
				.gte("touches", MAX_TOUCHES)
				.is("replied_at", null)
				.lte("first_touch_at", threshold);
			if (error) fail("listar contactos agotados", error);
			const candidates = (data ?? []).map(toContact).filter((c) =>
				isNoResponse({
					touches: c.touches,
					firstTouchAt: c.firstTouchAt ? new Date(c.firstTouchAt) : null,
					repliedAt: c.repliedAt ? new Date(c.repliedAt) : null,
					now,
				}),
			);
			if (candidates.length === 0) return [];

			// Idempotencia del freno: `oportunidad_frenada` tiene dedup de 2h en
			// events_dedup(), no de 24h, así que el trigger de la base no alcanza
			// contra un cron diario. Un contacto que ya tiene el evento no vuelve
			// a aparecer acá, así que nunca se re-emite ni se re-cuenta.
			const { data: frenados, error: frenadosError } = await client
				.from("events")
				.select("contact_key")
				.eq("tenant_id", tenantId)
				.eq("type", "oportunidad_frenada")
				.in(
					"contact_key",
					candidates.map((c) => c.contactKey),
				);
			if (frenadosError)
				fail("listar oportunidades ya frenadas", frenadosError);
			const yaFrenados = new Set(
				(frenados ?? []).map((r) => r.contact_key as string),
			);

			return candidates.filter((c) => !yaFrenados.has(c.contactKey));
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

		async countRecentReplies(tenantId, since) {
			const { data: contacts, error: contactsError } = await client
				.from("contacts")
				.select("contact_key")
				.eq("tenant_id", tenantId)
				.eq("stage", "respuesta_neutra");
			if (contactsError)
				fail("leer contactos en respuesta_neutra", contactsError);
			const keys = (contacts ?? []).map((r) => r.contact_key as string);
			if (keys.length === 0) return 0;
			const { data: events, error: eventsError } = await client
				.from("events")
				.select("contact_key")
				.eq("tenant_id", tenantId)
				.eq("type", "respuesta")
				.gte("created_at", since.toISOString())
				.in("contact_key", keys);
			if (eventsError) fail("contar respuestas recientes", eventsError);
			return new Set((events ?? []).map((r) => r.contact_key as string)).size;
		},

		async countStalled(tenantId, since) {
			const { data, error } = await client
				.from("events")
				.select("id")
				.eq("tenant_id", tenantId)
				.eq("type", "oportunidad_frenada")
				.gte("created_at", since.toISOString());
			if (error) fail("contar oportunidades frenadas", error);
			return (data ?? []).length;
		},

		async listActiveFocuses(tenantId) {
			const { data, error } = await client
				.from("search_focuses")
				.select(FOCUS_COLUMNS)
				.eq("tenant_id", tenantId)
				.eq("status", "activo");
			if (error) fail("listar focos activos", error);
			return (data ?? []).map(toFocus);
		},

		async loadFocus(tenantId, id) {
			const { data, error } = await client
				.from("search_focuses")
				.select(FOCUS_COLUMNS)
				.eq("tenant_id", tenantId)
				.eq("id", id)
				.maybeSingle();
			if (error) fail("leer el foco", error);
			return data ? toFocus(data) : null;
		},

		async updateFocus(tenantId, id, patch) {
			const { error } = await client
				.from("search_focuses")
				.update({
					...toColumns(patch, FOCUS_PATCH_COLUMNS),
					updated_at: new Date().toISOString(),
				})
				.eq("tenant_id", tenantId)
				.eq("id", id);
			if (error) fail("actualizar el foco", error);
		},

		async upsertDiscoveredAccount(row) {
			// Un select-de-existencia seguido de un upsert deja una ventana TOCTOU:
			// `research_account` (tool de chat sin lease) puede crear la cuenta con
			// research real justo en el medio, y el upsert de descubrimiento la
			// pisaría con `ficha: {}`. La función atómica resuelve todo en una sola
			// sentencia: `ficha`/`expires_at` solo se tocan en el insert.
			const { data, error } = await client.rpc("upsert_discovered_account", {
				p_tenant_id: row.tenantId,
				p_domain: row.domain,
				p_name: row.name,
				p_firmographics: row.firmographics,
				p_external_ids: row.externalIds,
			});
			if (error || !data) fail("guardar la cuenta descubierta", error);
			return { id: data as string };
		},

		async insertDiscoveredContact(row) {
			const { data, error } = await client
				.from("contacts")
				.insert({
					tenant_id: row.tenantId,
					contact_key: row.contactKey,
					account_id: row.accountId,
					owner_user_id: row.ownerUserId,
					search_focus_id: row.searchFocusId,
					name: row.name,
					company: row.company,
					title: row.title,
					linkedin_slug: row.linkedinSlug,
					segment: row.segment,
					vector: row.vector,
					hook: row.hook,
					idioma: row.idioma,
					external_ids: row.externalIds,
					source: "apollo",
				})
				.select("id")
				.single();
			if (error?.code === "23505") return "duplicado";
			if (error || !data) fail("crear el contacto descubierto", error);
			return { id: data.id as string };
		},

		async hasContactBeenTouched(tenantId, contactKey) {
			const [events, queueItems] = await Promise.all([
				client
					.from("events")
					.select("id", { head: true, count: "exact" })
					.eq("tenant_id", tenantId)
					.eq("contact_key", contactKey),
				client
					.from("queue_items")
					.select("id", { head: true, count: "exact" })
					.eq("tenant_id", tenantId)
					.eq("contact_key", contactKey),
			]);
			if (events.error) fail("chequear eventos del contacto", events.error);
			if (queueItems.error) fail("chequear piezas del contacto", queueItems.error);
			return (events.count ?? 0) > 0 || (queueItems.count ?? 0) > 0;
		},

		async promoteContactKey(tenantId, id, patch) {
			const { data, error } = await client
				.from("contacts")
				.update({ contact_key: patch.newKey, email: patch.email })
				.eq("tenant_id", tenantId)
				.eq("id", id)
				.eq("contact_key", patch.oldKey)
				.select("id")
				.maybeSingle();
			if (error) {
				if (error.code === "23505") return "duplicado";
				fail("promover la clave del contacto", error);
			}
			return data ? "promovido" : "carrera_perdida";
		},

		async listFocuses(tenantId) {
			const { data, error } = await client
				.from("search_focuses")
				.select(FOCUS_COLUMNS)
				.eq("tenant_id", tenantId)
				.order("created_at", { ascending: false });
			if (error) fail("listar los focos", error);
			return (data ?? []).map(toFocus);
		},

		async insertFocus(row) {
			const { data, error } = await client
				.from("search_focuses")
				.insert({
					tenant_id: row.tenantId,
					created_by: row.createdBy,
					name: row.name,
					criteria: row.criteria,
					vector: row.vector,
					segment: row.segment,
					hook: row.hook,
					idioma: row.idioma,
					max_accounts: row.maxAccounts,
					max_contacts: row.maxContacts,
				})
				.select(FOCUS_COLUMNS)
				.single();
			if (error || !data) fail("crear el foco", error);
			return toFocus(data);
		},

		async funnelForFocus(tenantId, focusId) {
			const { data: contacts, error: contactsError } = await client
				.from("contacts")
				.select("contact_key, icp, email")
				.eq("tenant_id", tenantId)
				.eq("search_focus_id", focusId);
			if (contactsError) fail("armar el embudo del foco", contactsError);
			const rows = contacts ?? [];
			const lane = (r: Row) => (r.icp as { lane?: string } | null)?.lane ?? null;
			const keys = rows.map((r) => r.contact_key as string);

			const { data: queueItems, error: queueError } = keys.length
				? await client
						.from("queue_items")
						.select("status")
						.eq("tenant_id", tenantId)
						.in("contact_key", keys)
				: { data: [] as { status: string }[], error: null };
			if (queueError) fail("armar el embudo del foco", queueError);

			return {
				descubiertos: rows.length,
				calificados: rows.filter((r) => lane(r) === "calificado").length,
				descartados: rows.filter((r) => lane(r) === "descartado").length,
				paraRevisar: rows.filter((r) => lane(r) === "para_revisar").length,
				enriquecidos: rows.filter((r) => r.email !== null).length,
				encolados: (queueItems ?? []).length,
				enviados: (queueItems ?? []).filter((q) => q.status === "sent").length,
			};
		},
	};
}
