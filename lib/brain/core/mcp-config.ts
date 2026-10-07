// Configuración del proveedor mcp del brain (spec etapa 11 §7.1). Sin secretos:
// la llave está en Vercel Connect. Lo usa el script de alta con Node directo.
import { parseCategories } from "./config.ts";
import { type McpLimits, parseMcpLimits } from "./limits.ts";

export interface McpBrainConfig {
	url: string;
	tools: { search: string; read: string; upsert: string };
	categories: string[];
	timeoutMs: number;
	mcpLimits: McpLimits;
}

const KNOWN_KEYS = new Set([
	"url",
	"tools",
	"categories",
	"timeoutMs",
	"mcpLimits",
]);
const TOOL_KEYS = ["search", "read", "upsert"] as const;
const TOOL_NAME = /^[A-Za-z0-9_.-]{1,64}$/;
const DEFAULT_TOOLS = {
	search: "brain_search",
	read: "brain_read",
	upsert: "brain_upsert",
};
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1"]);

function parseUrl(value: unknown, nodeEnv: string | undefined): string {
	if (typeof value !== "string")
		throw new Error("url tiene que ser una URL https");
	let url: URL;
	try {
		url = new URL(value);
	} catch {
		throw new Error("url tiene que ser una URL https");
	}
	const localDev =
		nodeEnv !== "production" &&
		url.protocol === "http:" &&
		LOCAL_HOSTS.has(url.hostname);
	if (url.protocol !== "https:" && !localDev) {
		throw new Error(
			"url tiene que ser https (http solo para localhost fuera de producción)",
		);
	}
	return url.toString();
}

function parseTools(value: unknown): McpBrainConfig["tools"] {
	if (value === undefined) return { ...DEFAULT_TOOLS };
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		throw new Error("tools tiene que ser un objeto con search, read y upsert");
	}
	const raw = value as Record<string, unknown>;
	const tools = { ...DEFAULT_TOOLS };
	for (const key of Object.keys(raw)) {
		if (!(TOOL_KEYS as readonly string[]).includes(key)) {
			throw new Error(`clave desconocida en tools: ${key}`);
		}
		const name = raw[key];
		if (typeof name !== "string" || !TOOL_NAME.test(name)) {
			throw new Error(
				`tools.${key} tiene que ser un nombre de tool (letras, números, _ . -)`,
			);
		}
		tools[key as (typeof TOOL_KEYS)[number]] = name;
	}
	return tools;
}

function parseTimeout(value: unknown): number {
	if (value === undefined) return 10000;
	if (
		typeof value !== "number" ||
		!Number.isInteger(value) ||
		value < 1000 ||
		value > 30000
	) {
		throw new Error("timeoutMs tiene que ser un entero entre 1000 y 30000");
	}
	return value;
}

export function parseMcpBrainConfig(
	value: unknown,
	nodeEnv: string | undefined = process.env.NODE_ENV,
): McpBrainConfig {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		throw new Error(
			"la configuración del brain mcp tiene que ser un objeto JSON",
		);
	}
	const raw = value as Record<string, unknown>;
	const unknownKeys = Object.keys(raw).filter((key) => !KNOWN_KEYS.has(key));
	if (unknownKeys.length > 0) {
		throw new Error(
			`claves desconocidas en la configuración del brain mcp: ${unknownKeys.join(", ")}`,
		);
	}
	return {
		url: parseUrl(raw.url, nodeEnv),
		tools: parseTools(raw.tools),
		categories: parseCategories(raw.categories),
		timeoutMs: parseTimeout(raw.timeoutMs),
		mcpLimits: parseMcpLimits(raw.mcpLimits),
	};
}
