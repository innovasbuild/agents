// Lectura de una página pública para el research (spec 03 §6.3, plan B de S4).
// La URL la elige el modelo a partir de texto no confiable (dominio del CSV,
// links de páginas): esto es un borde de seguridad contra SSRF. Solo http(s)
// a puertos estándar, sin credenciales, y todo host tiene que resolver a IPs
// públicas antes de cada request, redirecciones incluidas.
import { isIPv4, isIPv6 } from "node:net";

export interface WebPage {
	url: string;
	status: number;
	title: string | null;
	text: string;
	truncated: boolean;
}

export type WebPageResult =
	| { ok: true; page: WebPage }
	| { ok: false; reason: string; message: string };

export interface WebPageDeps {
	fetchImpl: typeof fetch;
	/** IPs (v4 y v6) del host. */
	resolveHost: (hostname: string) => Promise<string[]>;
}

export const WEB_PAGE_MAX_BYTES = 1_000_000;
export const WEB_PAGE_MAX_CHARS = 20_000;
const MAX_REDIRECTS = 3;
const TIMEOUT_MS = 10_000;

function fail(
	reason: string,
	message: string,
): Extract<WebPageResult, { ok: false }> {
	return { ok: false, reason, message };
}

function parseIPv4(ip: string): number[] | null {
	if (!isIPv4(ip)) return null;
	return ip.split(".").map(Number);
}

function isPublicIPv4([a, b, c]: number[]): boolean {
	if (a === 0 || a === 10 || a === 127) return false;
	if (a === 100 && b >= 64 && b <= 127) return false;
	if (a === 169 && b === 254) return false;
	if (a === 172 && b >= 16 && b <= 31) return false;
	if (a === 192 && b === 0 && c === 0) return false;
	if (a === 192 && b === 168) return false;
	if (a === 198 && (b === 18 || b === 19)) return false;
	if (a >= 224) return false; // 224/4 multicast y 240/4 reservada
	return true;
}

/** Los 16 bytes de una IPv6 (con o sin IPv4 embebida al final), o null. */
function parseIPv6(ip: string): number[] | null {
	if (!isIPv6(ip)) return null; // también rechaza zonas como fe80::1%en0
	let head = ip;
	const tail: number[] = [];
	const lastColon = head.lastIndexOf(":");
	const v4 = parseIPv4(head.slice(lastColon + 1));
	if (v4) {
		head = `${head.slice(0, lastColon + 1)}0:0`;
		tail.push(...v4);
	}
	const [left, right] = head.includes("::") ? head.split("::") : [head, null];
	const toGroups = (part: string) =>
		part === "" ? [] : part.split(":").map((g) => Number.parseInt(g, 16));
	const leftGroups = toGroups(left);
	const rightGroups = right === null ? [] : toGroups(right);
	const zeros = 8 - leftGroups.length - rightGroups.length;
	const groups = [
		...leftGroups,
		...Array<number>(right === null ? 0 : zeros).fill(0),
		...rightGroups,
	];
	if (groups.length !== 8) return null;
	const bytes = groups.flatMap((g) => [g >> 8, g & 0xff]);
	if (tail.length === 4) bytes.splice(12, 4, ...tail);
	return bytes;
}

/** Una IP que no parsea no es pública. */
export function isPublicAddress(ip: string): boolean {
	const v4 = parseIPv4(ip);
	if (v4) return isPublicIPv4(v4);
	const bytes = parseIPv6(ip);
	if (!bytes) return false;
	const allZeroUpTo = (n: number) => bytes.slice(0, n).every((b) => b === 0);
	if (allZeroUpTo(10) && bytes[10] === 0xff && bytes[11] === 0xff) {
		return isPublicIPv4(bytes.slice(12)); // ::ffff:a.b.c.d
	}
	if (allZeroUpTo(15) && (bytes[15] === 0 || bytes[15] === 1)) return false; // :: y ::1
	if ((bytes[0] & 0xfe) === 0xfc) return false; // fc00::/7
	if (bytes[0] === 0xfe && (bytes[1] & 0xc0) === 0x80) return false; // fe80::/10
	if (bytes[0] === 0xff) return false; // ff00::/8
	return true;
}

const notAllowed = () =>
	fail(
		"url_no_permitida",
		"esa URL no se puede leer: solo páginas públicas por http o https, sin usuario, sin puertos raros y sin direcciones internas",
	);

/** Valida la URL y que su host resuelva solo a IPs públicas. */
async function checkUrl(
	url: URL,
	deps: WebPageDeps,
): Promise<Extract<WebPageResult, { ok: false }> | null> {
	if (url.protocol !== "http:" && url.protocol !== "https:")
		return notAllowed();
	if (url.username || url.password) return notAllowed();
	if (url.port !== "" && url.port !== "80" && url.port !== "443")
		return notAllowed();
	const hostname = url.hostname.replace(/^\[|\]$/g, "").replace(/\.$/, "");
	const lower = hostname.toLowerCase();
	if (lower === "localhost" || lower.endsWith(".localhost"))
		return notAllowed();
	let addresses: string[];
	if (isIPv4(hostname) || isIPv6(hostname)) {
		addresses = [hostname];
	} else {
		try {
			addresses = await deps.resolveHost(hostname);
		} catch {
			return fail("no_responde", `no pude resolver ${hostname}`);
		}
		if (addresses.length === 0)
			return fail("no_responde", `no pude resolver ${hostname}`);
	}
	if (!addresses.every(isPublicAddress)) return notAllowed();
	return null;
}

async function readLimited(
	body: ReadableStream<Uint8Array> | null,
): Promise<{ bytes: Uint8Array; cut: boolean }> {
	if (!body) return { bytes: new Uint8Array(), cut: false };
	const reader = body.getReader();
	const chunks: Uint8Array[] = [];
	let size = 0;
	let cut = false;
	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			const room = WEB_PAGE_MAX_BYTES - size;
			if (value.length >= room) {
				chunks.push(value.subarray(0, room));
				size += room;
				cut = value.length > room;
				break;
			}
			chunks.push(value);
			size += value.length;
		}
		if (size >= WEB_PAGE_MAX_BYTES) cut = true;
	} finally {
		await reader.cancel().catch(() => {});
	}
	const bytes = new Uint8Array(size);
	let offset = 0;
	for (const chunk of chunks) {
		bytes.set(chunk, offset);
		offset += chunk.length;
	}
	return { bytes, cut };
}

export async function fetchPublicPage(
	rawUrl: string,
	deps: WebPageDeps,
): Promise<WebPageResult> {
	let url: URL;
	try {
		url = new URL(rawUrl);
	} catch {
		return notAllowed();
	}
	for (let redirects = 0; ; redirects++) {
		const refused = await checkUrl(url, deps);
		if (refused) return refused;

		let response: Response;
		try {
			response = await deps.fetchImpl(url.href, {
				redirect: "manual",
				signal: AbortSignal.timeout(TIMEOUT_MS),
				headers: { accept: "text/html, text/plain;q=0.9" },
			});
		} catch {
			return fail("no_responde", `${url.hostname} no respondió a tiempo`);
		}

		const location = response.headers.get("location");
		if (response.status >= 300 && response.status < 400 && location) {
			await response.body?.cancel().catch(() => {});
			if (redirects >= MAX_REDIRECTS)
				return fail(
					"demasiadas_redirecciones",
					`${url.hostname} redirige más de ${MAX_REDIRECTS} veces`,
				);
			try {
				url = new URL(location, url);
			} catch {
				return notAllowed();
			}
			continue;
		}

		if (response.status < 200 || response.status >= 300) {
			await response.body?.cancel().catch(() => {});
			return fail(
				`http_${response.status}`,
				`la página respondió ${response.status}`,
			);
		}

		const contentType = (response.headers.get("content-type") ?? "")
			.trim()
			.toLowerCase();
		const isHtml = contentType.startsWith("text/html");
		if (!isHtml && !contentType.startsWith("text/plain")) {
			await response.body?.cancel().catch(() => {});
			return fail(
				"tipo_no_soportado",
				"la página no es HTML ni texto: no la puedo leer",
			);
		}

		let read: { bytes: Uint8Array; cut: boolean };
		try {
			read = await readLimited(response.body);
		} catch {
			return fail("no_responde", `${url.hostname} cortó la respuesta`);
		}
		const raw = new TextDecoder().decode(read.bytes);
		const { title, text: fullText } = isHtml
			? htmlToText(raw)
			: { title: null, text: collapseWhitespace(raw) };
		const text = fullText.slice(0, WEB_PAGE_MAX_CHARS);
		return {
			ok: true,
			page: {
				url: url.href,
				status: response.status,
				title,
				text,
				truncated: read.cut || text.length < fullText.length,
			},
		};
	}
}

const NAMED_ENTITIES: Record<string, string> = {
	amp: "&",
	lt: "<",
	gt: ">",
	quot: '"',
	"#39": "'",
	nbsp: " ",
};

function decodeEntities(value: string): string {
	return value.replace(
		/&(amp|lt|gt|quot|#39|nbsp|#\d{1,7}|#x[0-9a-f]{1,6});/gi,
		(entity, name: string) => {
			const lower = name.toLowerCase();
			if (lower in NAMED_ENTITIES) return NAMED_ENTITIES[lower];
			const code = lower.startsWith("#x")
				? Number.parseInt(lower.slice(2), 16)
				: Number.parseInt(lower.slice(1), 10);
			return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : entity;
		},
	);
}

function collapseWhitespace(value: string): string {
	return value
		.replace(/\r\n?/g, "\n")
		.split("\n")
		.map((line) => line.replace(/[ \t\f\v ]+/g, " ").trim())
		.join("\n")
		.replace(/\n{3,}/g, "\n\n")
		.trim();
}

// Las regex evitan backtracking cuadrático ante HTML roto: un bloque sin
// cerrar se come el resto del documento y las etiquetas no cruzan un `<`.
export function htmlToText(html: string): {
	title: string | null;
	text: string;
} {
	const titleMatch = /<title\b[^<>]*>([^<]*)/i.exec(html);
	const title = titleMatch
		? collapseWhitespace(decodeEntities(titleMatch[1])).replace(/\s+/g, " ")
		: "";
	const text = html
		.replace(/<!--[\s\S]*?(?:-->|$)/g, "")
		.replace(
			/<(script|style|noscript|svg|title)\b[\s\S]*?(?:<\/\1\s*>|$)/gi,
			"",
		)
		.replace(/<br\b[^<>]*>|<\/(?:p|li|h[1-6]|div)\s*>/gi, "\n")
		.replace(/<[^<>]*>/g, "");
	return {
		title: title || null,
		text: collapseWhitespace(decodeEntities(text)),
	};
}
