// Límites por minuto del endpoint MCP del brain (spec etapa 11 §6.2). Sin
// imports: lo usa scripts/connections-bind.mts con Node directo.

export interface McpLimits {
	readsPerMinute: number;
	writesPerMinute: number;
}

export const DEFAULT_MCP_LIMITS: McpLimits = {
	readsPerMinute: 60,
	writesPerMinute: 10,
};

const KEYS = new Set(["readsPerMinute", "writesPerMinute"]);

function limit(value: unknown, fallback: number, name: string): number {
	if (value === undefined) return fallback;
	if (
		typeof value !== "number" ||
		!Number.isInteger(value) ||
		value < 1 ||
		value > 1000
	) {
		throw new Error(`mcpLimits.${name} tiene que ser un entero entre 1 y 1000`);
	}
	return value;
}

export function parseMcpLimits(value: unknown): McpLimits {
	if (value === undefined) return { ...DEFAULT_MCP_LIMITS };
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		throw new Error("mcpLimits tiene que ser un objeto JSON");
	}
	const raw = value as Record<string, unknown>;
	const unknownKeys = Object.keys(raw).filter((key) => !KEYS.has(key));
	if (unknownKeys.length > 0) {
		throw new Error(
			`claves desconocidas en mcpLimits: ${unknownKeys.join(", ")}`,
		);
	}
	return {
		readsPerMinute: limit(
			raw.readsPerMinute,
			DEFAULT_MCP_LIMITS.readsPerMinute,
			"readsPerMinute",
		),
		writesPerMinute: limit(
			raw.writesPerMinute,
			DEFAULT_MCP_LIMITS.writesPerMinute,
			"writesPerMinute",
		),
	};
}
