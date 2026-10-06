import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { findViolations } from "./boundary-check";

const CORE = fileURLToPath(new URL("../../lib/brain/core", import.meta.url));

function sourceFiles(dir: string): string[] {
	return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
		const path = join(dir, entry.name);
		if (entry.isDirectory()) return sourceFiles(path);
		return /\.(ts|tsx|mts)$/.test(entry.name) ? [path] : [];
	});
}

describe("detector de frontera", () => {
	const file = join(CORE, "editor", "x.ts");

	it("acepta imports internos, zod, yaml, el SDK de MCP y node:*", () => {
		const source = [
			'import { a } from "../types.ts";',
			'import { z } from "zod";',
			'import { parse } from "yaml";',
			'import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";',
			'import { createHash } from "node:crypto";',
			'import type { SupabaseClient } from "@supabase/supabase-js";',
		].join("\n");
		expect(findViolations(file, source, CORE)).toEqual([]);
	});

	it("rechaza el alias @/, un relativo que sale de core y paquetes ajenos", () => {
		expect(
			findViolations(file, 'import { x } from "@/lib/supabase/admin";', CORE),
		).toHaveLength(1);
		expect(
			findViolations(file, 'import { x } from "../../connectors/auth";', CORE),
		).toHaveLength(1);
		expect(
			findViolations(file, 'import { cache } from "react";', CORE),
		).toHaveLength(1);
		expect(
			findViolations(file, 'import { defineTool } from "eve/tools";', CORE),
		).toHaveLength(1);
	});

	it("detecta imports en varias líneas y re-exports", () => {
		const multiline = 'import {\n  a,\n  b,\n} from "eve/channels/auth";';
		expect(findViolations(file, multiline, CORE)).toHaveLength(1);
		expect(
			findViolations(file, 'export { x } from "@/lib/foo";', CORE),
		).toHaveLength(1);
	});

	it("detecta import() dinámico y require, y acepta los permitidos", () => {
		expect(
			findViolations(file, 'const m = await import("@/lib/x");', CORE),
		).toHaveLength(1);
		expect(
			findViolations(file, 'const e = require("eve/tools");', CORE),
		).toHaveLength(1);
		expect(
			findViolations(file, 'const t = await import("./types.ts");', CORE),
		).toEqual([]);
		expect(findViolations(file, 'const z = require("zod");', CORE)).toEqual([]);
	});

	it("exige import type para @supabase/supabase-js", () => {
		expect(
			findViolations(
				file,
				'import { createClient } from "@supabase/supabase-js";',
				CORE,
			),
		).toHaveLength(1);
	});
});

describe("lib/brain/core", () => {
	it("no importa nada de afuera del módulo", () => {
		const violations = sourceFiles(CORE).flatMap((file) =>
			findViolations(file, readFileSync(file, "utf8"), CORE).map(
				(v) => `${file.slice(CORE.length + 1)}: ${v}`,
			),
		);
		expect(violations).toEqual([]);
	});
});
