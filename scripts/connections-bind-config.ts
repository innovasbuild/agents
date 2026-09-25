// scripts/connections-bind-config.ts
// Import con extensión .ts: lo ejecuta Node directo.
import { readFile } from "node:fs/promises";
import { parseWikiConfig } from "../lib/brain/config.ts";
import { parseMcpBrainConfig } from "../lib/brain/mcp-config.ts";
import type { ProviderKey } from "../lib/connectors/providers.ts";

export function validateProviderConfig(
	provider: ProviderKey,
	raw: unknown,
): Record<string, unknown> {
	if (provider === "wiki") return { ...parseWikiConfig(raw) };
	if (provider === "mcp") return { ...parseMcpBrainConfig(raw, "production") };
	throw new Error(`${provider} no acepta --config`);
}

export async function loadProviderConfig(
	provider: ProviderKey,
	path: string,
): Promise<Record<string, unknown>> {
	let raw: unknown;
	try {
		raw = JSON.parse(await readFile(path, "utf8"));
	} catch (error) {
		throw new Error(
			`no pude leer ${path} como JSON: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
	return validateProviderConfig(provider, raw);
}
