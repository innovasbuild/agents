// TEMPORAL (spec 03 §13, spike S2): se borra después de correr el spike en
// producción. Diagnóstico de lectura de Gmail: ¿el conector google/google
// concede gmail.readonly junto con gmail.send, y Gmail respeta el
// Message-ID que ponemos nosotros?

export interface QueueItemRef {
	id: string;
	contactId: string;
}

export interface S2Deps {
	tokenForSubject: (
		connector: string,
		who: { tenantId: string; userId: string; issuer?: string },
		scopes?: string[],
	) => Promise<{ token: string; expiresAt: number }>;
	fetch: typeof fetch;
	/**
	 * Con `queueItemId`, trae esa fila (validando tenant); sin él, la última
	 * `queue_items` con `status = 'sent'` del tenant y ejecutor de la sesión.
	 */
	findQueueItem: (params: {
		tenantId: string;
		executorUserId: string;
		queueItemId?: string;
	}) => Promise<QueueItemRef | null>;
	getContactEmail: (
		tenantId: string,
		contactId: string,
	) => Promise<string | null>;
}

export interface S2Input {
	tenantId: string;
	userId: string;
	issuer: string;
	/** Email de quien corre la sesión: arma el mismo senderDomain que send.ts. */
	callerEmail: string;
	queueItemId?: string;
}

export type ProbeStep = { step: string; ok: boolean; detail: string };

const GMAIL_BASE = "https://gmail.googleapis.com/gmail/v1/users/me";
const TOKENINFO_URL = "https://oauth2.googleapis.com/tokeninfo";
const SCOPE_SEND = "https://www.googleapis.com/auth/gmail.send";
const SCOPE_READONLY = "https://www.googleapis.com/auth/gmail.readonly";
const FETCH_TIMEOUT_MS = 10_000;
const MAX_DETAIL_LENGTH = 500;

// Corre un paso aislado: si `fn` tira, el paso queda ok:false con el nombre y
// mensaje del error (nunca un token, porque ninguna `fn` de abajo lo pone en
// el mensaje de un error propio). Un paso que falla nunca frena a los demás.
async function runStep(
	step: string,
	fn: () => Promise<string>,
): Promise<ProbeStep> {
	try {
		const detail = await fn();
		return { step, ok: true, detail: detail.slice(0, MAX_DETAIL_LENGTH) };
	} catch (error) {
		const detail =
			error instanceof Error
				? `${error.name}: ${error.message}`
				: String(error);
		return { step, ok: false, detail: detail.slice(0, MAX_DETAIL_LENGTH) };
	}
}

function vence(expiresAt: number): string {
	return new Date(expiresAt).toISOString();
}

function senderDomainFor(callerEmail: string): string {
	return callerEmail.split("@")[1] || "outreach.local";
}

function maskEmail(email: string): string {
	const at = email.indexOf("@");
	if (at <= 0) return "***";
	return `${email[0]}***${email.slice(at)}`;
}

async function countMessages(response: Response): Promise<number> {
	try {
		const data = (await response.json()) as { messages?: unknown[] };
		return Array.isArray(data.messages) ? data.messages.length : 0;
	} catch {
		return 0;
	}
}

interface TokenInfo {
	scope?: string;
	expires_in?: number;
	email?: string;
}

// Primero un POST con el token en el body (nunca en la URL); si Google lo
// rechaza, un GET con Authorization: Bearer. Si ninguno funciona, null: el
// llamador deja el paso como ok:false sin recurrir al querystring.
async function fetchTokenInfo(
	fetchFn: typeof fetch,
	token: string,
): Promise<TokenInfo | null> {
	try {
		const response = await fetchFn(TOKENINFO_URL, {
			method: "POST",
			headers: { "Content-Type": "application/x-www-form-urlencoded" },
			body: `access_token=${encodeURIComponent(token)}`,
			signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
		});
		if (response.ok) {
			return (await response.json()) as TokenInfo;
		}
	} catch {
		// sigue al segundo intento
	}
	try {
		const response = await fetchFn(TOKENINFO_URL, {
			method: "GET",
			headers: { Authorization: `Bearer ${token}` },
			signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
		});
		if (response.ok) {
			return (await response.json()) as TokenInfo;
		}
	} catch {
		// ninguno funcionó
	}
	return null;
}

export async function runS2Probes(
	input: S2Input,
	deps: S2Deps,
): Promise<ProbeStep[]> {
	const { tenantId, userId, issuer } = input;
	const senderDomain = senderDomainFor(input.callerEmail);
	const steps: ProbeStep[] = [];

	// El token de este paso se guarda en una variable local (nunca en
	// `steps`) para reusarlo en s2.scopes, s2.messages.list, s2.rfc822msgid
	// y s2.fallback.
	let readonlyToken: string | undefined;

	steps.push(
		await runStep("s2.token.send", async () => {
			const { expiresAt } = await deps.tokenForSubject(
				"google/google",
				{ tenantId, userId, issuer },
				[SCOPE_SEND],
			);
			return `token ok, vence ${vence(expiresAt)}`;
		}),
	);

	steps.push(
		await runStep("s2.token.readonly", async () => {
			try {
				const { token, expiresAt } = await deps.tokenForSubject(
					"google/google",
					{ tenantId, userId, issuer },
					[SCOPE_SEND, SCOPE_READONLY],
				);
				readonlyToken = token;
				return `token ok, vence ${vence(expiresAt)}`;
			} catch (error) {
				const name = error instanceof Error ? error.name : "Error";
				const message = error instanceof Error ? error.message : String(error);
				const wrapped =
					name === "UserAuthorizationRequiredError"
						? new Error(
								`hace falta volver a autorizar google (gmail.readonly) en el chat — ${message}`,
							)
						: new Error(message);
				wrapped.name = name;
				throw wrapped;
			}
		}),
	);

	steps.push(
		await runStep("s2.scopes", async () => {
			if (!readonlyToken) {
				throw new Error("sin token readonly (falló s2.token.readonly)");
			}
			const info = await fetchTokenInfo(deps.fetch, readonlyToken);
			if (!info) {
				throw new Error(
					"no se pudo leer los scopes sin exponer el token (tokeninfo por body y por header fallaron); ver s2.messages.list y s2.rfc822msgid",
				);
			}
			const scopes = info.scope
				? info.scope.split(/[ ,]+/).filter(Boolean)
				: [];
			const domain = info.email?.includes("@")
				? info.email.split("@")[1]
				: undefined;
			return `scopes [${scopes.join(", ")}], expires_in ${info.expires_in ?? "?"}${domain ? `, email dominio ${domain}` : ""}`;
		}),
	);

	steps.push(
		await runStep("s2.messages.list", async () => {
			if (!readonlyToken) {
				throw new Error("sin token readonly (falló s2.token.readonly)");
			}
			const query = new URLSearchParams({
				q: "in:sent newer_than:1d",
				maxResults: "5",
			});
			const response = await deps.fetch(`${GMAIL_BASE}/messages?${query}`, {
				headers: { Authorization: `Bearer ${readonlyToken}` },
				signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
			});
			const count = await countMessages(response);
			return `status ${response.status}, mensajes ${count}`;
		}),
	);

	// Resolución compartida entre s2.rfc822msgid y s2.fallback: una sola
	// consulta a la base, cacheada, que ninguna de las dos frena si falla.
	let queueItemPromise: Promise<QueueItemRef | null> | undefined;
	function resolveQueueItem(): Promise<QueueItemRef | null> {
		if (!queueItemPromise) {
			queueItemPromise = deps.findQueueItem({
				tenantId,
				executorUserId: userId,
				queueItemId: input.queueItemId,
			});
		}
		return queueItemPromise;
	}

	steps.push(
		await runStep("s2.rfc822msgid", async () => {
			if (!readonlyToken) {
				throw new Error("sin token readonly (falló s2.token.readonly)");
			}
			const queueItem = await resolveQueueItem();
			if (!queueItem) {
				throw new Error(
					"no encontré una pieza enviada para armar el Message-ID (pasá ?queue_item=<uuid> o mandá un mail de prueba primero)",
				);
			}
			const messageId = `<qi-${queueItem.id}@${senderDomain}>`;
			const query = new URLSearchParams({ q: `rfc822msgid:${messageId}` });
			const response = await deps.fetch(`${GMAIL_BASE}/messages?${query}`, {
				headers: { Authorization: `Bearer ${readonlyToken}` },
				signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
			});
			let messages: { id: string }[] = [];
			try {
				const data = (await response.json()) as { messages?: { id: string }[] };
				messages = Array.isArray(data.messages) ? data.messages : [];
			} catch {
				messages = [];
			}
			if (messages.length === 0) {
				return `buscado ${messageId}, status ${response.status}, resultados 0`;
			}
			const metaQuery = new URLSearchParams({
				format: "metadata",
				metadataHeaders: "Message-ID",
			});
			const metaResponse = await deps.fetch(
				`${GMAIL_BASE}/messages/${messages[0].id}?${metaQuery}`,
				{
					headers: { Authorization: `Bearer ${readonlyToken}` },
					signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
				},
			);
			let gmailMessageIdHeader: string | undefined;
			try {
				const metaData = (await metaResponse.json()) as {
					payload?: { headers?: { name: string; value: string }[] };
				};
				gmailMessageIdHeader = metaData.payload?.headers?.find(
					(header) => header.name === "Message-ID",
				)?.value;
			} catch {
				gmailMessageIdHeader = undefined;
			}
			const coincide = gmailMessageIdHeader === messageId;
			return `buscado ${messageId}, status ${response.status}, resultados ${messages.length}, coincide ${coincide}`;
		}),
	);

	steps.push(
		await runStep("s2.fallback", async () => {
			const queueItem = await resolveQueueItem();
			if (!queueItem) {
				throw new Error(
					"no encontré una pieza para el fallback (mismo motivo que s2.rfc822msgid)",
				);
			}
			const email = await deps.getContactEmail(tenantId, queueItem.contactId);
			if (!email) {
				throw new Error("sin email de contacto para esa pieza");
			}
			if (!readonlyToken) {
				throw new Error("sin token readonly (falló s2.token.readonly)");
			}
			const query = new URLSearchParams({
				q: `in:sent to:${email} newer_than:10d`,
			});
			const response = await deps.fetch(`${GMAIL_BASE}/messages?${query}`, {
				headers: { Authorization: `Bearer ${readonlyToken}` },
				signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
			});
			const count = await countMessages(response);
			return `to ${maskEmail(email)}, status ${response.status}, mensajes ${count}`;
		}),
	);

	return steps;
}
