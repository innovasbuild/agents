import { describe, expect, it } from "vitest";
import {
	inventory,
	isPlatformEnvVar,
	routeFromFile,
} from "../../scripts/docs/inventory.ts";

const FIXTURE = "tests/fixtures/docs/repo-minimo";
const keys = (list: { key: string }[]) => list.map((s) => s.key);

describe("inventory contra el repo de juguete", () => {
	const deps = {
		nodes: { "demo/uno": { effect: 1, tier: "barato" } },
		workflows: { flujo: { agent: "demo", claims: "a", produces: null } },
		providers: {
			p: { capability: "crm", multiple: false, kind: "tool", authKind: "none" },
		},
	};

	it("lista cada superficie del disco, ordenada", async () => {
		const inv = await inventory(FIXTURE, deps);
		expect(keys(inv.tools)).toEqual(["demo/bye", "demo/hello"]);
		expect(keys(inv.schedules)).toEqual(["demo/tick"]);
		expect(keys(inv.evals)).toEqual(["demo/smoke"]);
		expect(keys(inv.tables)).toEqual(["cosas"]);
		expect(keys(inv.migrations)).toEqual([
			"20260101000000_cosas",
			"20260102000000_borra_otras",
		]);
		expect(keys(inv.routes)).toEqual(["/", "/[tenant]/cosa", "/api/x"]);
		expect(keys(inv.scripts)).toEqual(["dev", "docs:sync"]);
		expect(keys(inv.specs)).toEqual(["2026-01-01-demo-design.md"]);
	});

	it("las variables de entorno excluyen las de la plataforma y los directorios .eve", async () => {
		const inv = await inventory(FIXTURE, deps);
		expect(keys(inv.envVars)).toEqual(["FOO"]);
	});

	it("nodos, workflows y proveedores salen de lo inyectado", async () => {
		const inv = await inventory(FIXTURE, deps);
		expect(keys(inv.nodes)).toEqual(["demo/uno"]);
		expect(keys(inv.workflows)).toEqual(["flujo"]);
		expect(keys(inv.providers)).toEqual(["p"]);
	});

	it("dos corridas dan lo mismo", async () => {
		expect(await inventory(FIXTURE, deps)).toEqual(
			await inventory(FIXTURE, deps),
		);
	});
});

describe("helpers", () => {
	it("routeFromFile saca grupos y conserva .well-known", () => {
		expect(routeFromFile("app/(auth)/ingresar/page.tsx")).toBe("/ingresar");
		expect(routeFromFile("app/.well-known/x/route.ts")).toBe("/.well-known/x");
		expect(routeFromFile("app/layout.tsx")).toBeNull();
	});

	it("isPlatformEnvVar reconoce prefijos", () => {
		expect(isPlatformEnvVar("VERCEL_URL")).toBe(true);
		expect(isPlatformEnvVar("XDG_CONFIG_HOME")).toBe(true);
		expect(isPlatformEnvVar("PLATFORM_OWNER_TENANT_SLUG")).toBe(false);
	});
});

describe("inventory contra el repo real", () => {
	it("encuentra lo que sabemos cierto hoy", async () => {
		const inv = await inventory(".");
		expect(keys(inv.tools)).toContain("outreach/send_email");
		expect(keys(inv.tables)).toContain("queue_items");
		expect(keys(inv.routes)).toContain("/[tenant]/cola");
		expect(keys(inv.envVars)).toContain("PLATFORM_OWNER_TENANT_SLUG");
		expect(keys(inv.envVars)).not.toContain("NODE_ENV");
		expect(keys(inv.workflows)).toContain("draft-queue");
		expect(keys(inv.providers)).toContain("hubspot");
	});
});

describe("inventory, casos de borde", () => {
	it("una raíz sin nada da listas vacías y no lanza", async () => {
		const inv = await inventory("tests/fixtures/docs/no-existe", {
			nodes: {},
			workflows: {},
			providers: {},
		});
		expect(inv.scripts).toEqual([]);
		expect(inv.tools).toEqual([]);
		expect(inv.envVars).toEqual([]);
	});

	it("un workflow suma sus nodos opcionales y un nodo sin tier queda vacío", async () => {
		const inv = await inventory("tests/fixtures/docs/no-existe", {
			nodes: { "d/x": { effect: 0, tier: null } },
			workflows: {
				w: {
					agent: "d",
					claims: "a",
					produces: "b",
					nodes: ["d/x"],
					optionalNodes: ["d/y"],
				},
			},
			providers: {},
		});
		expect(inv.nodes[0].meta?.tier).toBe("");
		expect(inv.workflows[0].meta?.nodes).toBe("d/x, d/y");
	});
});
