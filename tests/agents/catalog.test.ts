import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
	AGENT_CATALOG,
	catalogAgents,
	isCatalogAgent,
} from "@/lib/agents/catalog";

const ROOT = join(__dirname, "..", "..");

function agentDirs(): string[] {
	const dir = join(ROOT, "agents");
	return readdirSync(dir)
		.filter((name) => statSync(join(dir, name)).isDirectory())
		.filter((name) => existsSync(join(dir, name, "agent.ts")))
		.sort();
}

function nextConfigAgents(): string[] {
	const source = readFileSync(join(ROOT, "next.config.ts"), "utf8");
	const block = source.match(/agents:\s*{([^}]*)}/)?.[1] ?? "";
	return [...block.matchAll(/([a-z][a-z0-9-]*)\s*:/g)].map((m) => m[1]).sort();
}

describe("catálogo de agentes", () => {
	it("tiene una entrada por carpeta de agents/ y nada más", () => {
		expect(catalogAgents().sort()).toEqual(agentDirs());
	});

	it("coincide con los agentes que monta next.config.ts", () => {
		expect(catalogAgents().sort()).toEqual(nextConfigAgents());
	});

	it("cada entrada tiene nombre y descripción", () => {
		for (const [agent, entry] of Object.entries(AGENT_CATALOG)) {
			expect(entry.name.trim().length, agent).toBeGreaterThan(0);
			expect(entry.description.trim().length, agent).toBeGreaterThan(0);
			expect(entry.capabilities.length, agent).toBeGreaterThan(0);
		}
	});

	it("isCatalogAgent reconoce solo las claves del catálogo", () => {
		expect(isCatalogAgent("outreach")).toBe(true);
		expect(isCatalogAgent("soporte")).toBe(false);
		expect(isCatalogAgent("toString")).toBe(false);
	});

	it("el outreach requiere brain", () => {
		expect(AGENT_CATALOG.outreach.requiresBrain).toBe(true);
	});
});
