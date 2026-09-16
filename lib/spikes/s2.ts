// TEMPORAL (spec 03 §13, spike S2): se borra después de correr el spike en
// producción. Diagnóstico de lectura de Gmail: ¿el conector google/google
// concede gmail.readonly junto con gmail.send, y Gmail respeta el
// Message-ID que ponemos nosotros?

export interface QueueItemRef {
	id: string;
	toEmail: string;
	/** El id que Gmail asignó al enviar (queue_items.gmail_message_id). Con
	 * esto el chequeo de header es determinístico: no depende de que
	 * `rfc822msgid:` haya indexado nada. */
	gmailMessageId: string | null;
}

export interface S2Deps {
	tokenForSubject: (
		connector: string,
		who: { tenantId: string; userId: string; issuer?: string },
		scopes?: string[],
	) => Promise<{ token: string; expiresAt: number }>;
	fetch: typeof fetch;
	/**
	 * Con `queueItemId`, trae esa fila (validando tenant y que sea del mismo
	 * ejecutor que la sesión — si no, tira un error explícito en vez de
	 * devolver null); sin él, la última `queue_items` con `status = 'sent'`
	 * del tenant y ejecutor de la sesión.
	 */
	findQueueItem: (params: {
		tenantId: string;
		executorUserId: string;
		queueItemId?: string;
	}) => Promise<QueueItemRef | null>;
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
// 7 llamadas externas (2 tokens + tokeninfo + 2 listados gmail + 1 metadata
// determinística + 1 fallback) de 8s cada una, serializadas, más las
// consultas a la base: ~65s en el peor caso. maxDuration de la ruta es 120s.
const FETCH_TIMEOUT_MS = 8_000;
const TOKEN_TIMEOUT_MS = 8_000;
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

// @vercel/connect no acepta AbortSignal: sin esto, un tokenForSubject
// colgado se comería todo el presupuesto de la función y ningún paso
// posterior llegaría a correr.
function withTimeout<T>(
	promise: Promise<T>,
	ms: number,
	label: string,
): Promise<T> {
	return new Promise<T>((resolve, reject) => {
		const timer = setTimeout(() => {
			reject(new Error(`${label}: sin respuesta tras ${ms}ms`));
		}, ms);
		promise.then(
			(value) => {
				clearTimeout(timer);
				resolve(value);
			},
			(error) => {
				clearTimeout(timer);
				reject(error);
			},
		);
	});
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

// El token va en el body de un POST, nunca en la URL. Google no acepta este
// endpoint con Authorization: Bearer (era letra muerta), así que si el POST
// falla no hay segundo intento: el paso queda ok:false y el detail manda a
// s2.messages.list / s2.header_match, que igual contestan la pregunta.
async function fetchTokenInfo(
	fetchFn: typeof fetch,
	token: string,
): Promise<TokenInfo> {
	const response = await fetchFn(TOKENINFO_URL, {
		method: "POST",
		headers: { "Content-Type": "application/x-www-form-urlencoded" },
		body: `access_token=${encodeURIComponent(token)}`,
		signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
	});
	if (!response.ok) {
		throw new Error(
			`tokeninfo respondió ${response.status}; los scopes se infieren igual del 200/403 de s2.messages.list y de s2.header_match`,
		);
	}
	return (await response.json()) as TokenInfo;
}

export async function runS2Probes(
	input: S2Input,
	deps: S2Deps,
): Promise<ProbeStep[]> {
	const { tenantId, userId, issuer } = input;
	const senderDomain = senderDomainFor(input.callerEmail);
	const steps: ProbeStep[] = [];

	// El token de este paso se guarda en una variable local (nunca en
	// `steps`) para reusarlo en s2.scopes, s2.messages.list, s2.rfc822msgid,
	// s2.header_match y s2.fallback.
	let readonlyToken: string | undefined;

	steps.push(
		await runStep("s2.token.send", async () => {
			const { expiresAt } = await withTimeout(
				deps.tokenForSubject("google/google", { tenantId, userId, issuer }, [
					SCOPE_SEND,
				]),
				TOKEN_TIMEOUT_MS,
				"tokenForSubject",
			);
			return `token ok, vence ${vence(expiresAt)}`;
		}),
	);

	steps.push(
		await runStep("s2.token.readonly", async () => {
			try {
				const { token, expiresAt } = await withTimeout(
					deps.tokenForSubject("google/google", { tenantId, userId, issuer }, [
						SCOPE_SEND,
						SCOPE_READONLY,
					]),
					TOKEN_TIMEOUT_MS,
					"tokenForSubject",
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

	// Resolución compartida entre s2.rfc822msgid, s2.header_match y
	// s2.fallback: una sola consulta a la base, cacheada, que ninguno de los
	// tres frena si falla.
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

	// Responde "¿se encuentra buscando por rfc822msgid:?" — nada más. No
	// infiere coincidencia: 0 resultados puede ser tanto "Gmail reescribió el
	// id" como "todavía no lo indexó" como "buzón equivocado". Esa pregunta
	// la contesta s2.header_match, que es determinístico.
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
			const count = await countMessages(response);
			return `buscado ${messageId}, status ${response.status}, resultados ${count}`;
		}),
	);

	// Determinístico: usa el gmail_message_id que Gmail devolvió al enviar
	// (guardado en queue_items), no el resultado de una búsqueda. Tres
	// resultados distinguibles: coincide true, coincide false (el hallazgo
	// positivo que busca el spike: Gmail reescribió el id), o no se pudo
	// leer el header (status, sin inferir nada).
	steps.push(
		await runStep("s2.header_match", async () => {
			if (!readonlyToken) {
				throw new Error("sin token readonly (falló s2.token.readonly)");
			}
			const queueItem = await resolveQueueItem();
			if (!queueItem) {
				throw new Error(
					"no encontré una pieza enviada para comparar el header (pasá ?queue_item=<uuid> o mandá un mail de prueba primero)",
				);
			}
			if (!queueItem.gmailMessageId) {
				throw new Error(
					"esa pieza no tiene gmail_message_id guardado (mandá un mail de prueba nuevo o probá con otra pieza)",
				);
			}
			const ourMessageId = `<qi-${queueItem.id}@${senderDomain}>`;
			const metaQuery = new URLSearchParams({
				format: "metadata",
				metadataHeaders: "Message-ID",
			});
			const response = await deps.fetch(
				`${GMAIL_BASE}/messages/${queueItem.gmailMessageId}?${metaQuery}`,
				{
					headers: { Authorization: `Bearer ${readonlyToken}` },
					signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
				},
			);
			if (!response.ok) {
				throw new Error(
					`no se pudo leer el header Message-ID (status ${response.status})`,
				);
			}
			let gmailHeader: string | undefined;
			try {
				const data = (await response.json()) as {
					payload?: { headers?: { name: string; value: string }[] };
				};
				gmailHeader = data.payload?.headers?.find(
					(header) => header.name === "Message-ID",
				)?.value;
			} catch {
				gmailHeader = undefined;
			}
			if (!gmailHeader) {
				throw new Error(
					"no se pudo leer el header Message-ID (Gmail no lo devolvió)",
				);
			}
			// El header devuelto acá es metadata de NUESTRO propio mensaje
			// (el gmail_message_id que guardamos al enviar), sea que Gmail
			// haya conservado nuestro formato <qi-...> o lo haya reemplazado
			// por el suyo: no es dato de un tercero.
			if (gmailHeader === ourMessageId) {
				return `coincide true: Gmail devolvió el mismo Message-ID (${gmailHeader})`;
			}
			return `coincide false: Gmail devolvió ${gmailHeader} en vez de ${ourMessageId}`;
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
			if (!readonlyToken) {
				throw new Error("sin token readonly (falló s2.token.readonly)");
			}
			const query = new URLSearchParams({
				q: `in:sent to:${queueItem.toEmail} newer_than:10d`,
			});
			const response = await deps.fetch(`${GMAIL_BASE}/messages?${query}`, {
				headers: { Authorization: `Bearer ${readonlyToken}` },
				signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
			});
			const count = await countMessages(response);
			return `to ${maskEmail(queueItem.toEmail)}, status ${response.status}, mensajes ${count}`;
		}),
	);

	return steps;
}
