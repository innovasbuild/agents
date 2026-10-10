import { describe, expect, it } from "vitest";
import {
	approvableNodes,
	isPolicy,
	POLICIES,
	POLICY_HELP,
	POLICY_LABELS,
	readPolicy,
} from "@/lib/tenants/approvals";
import { NODES } from "@/lib/workflows/registry";

describe("approvableNodes", () => {
	it("son los nodos de nivel 2 del agente, y nada más", () => {
		const expected = Object.entries(NODES)
			.filter(
				([name, info]) => name.startsWith("outreach/") && info.effect === 2,
			)
			.map(([name]) => name)
			.sort();

		expect(approvableNodes("outreach")).toEqual(expected);
		expect(expected).toContain("outreach/crm-record");
	});

	it("nunca incluye un nodo de nivel 3", () => {
		for (const node of approvableNodes("outreach")) {
			expect(NODES[node]?.effect).toBe(2);
		}
		expect(approvableNodes("outreach")).not.toContain("outreach/send");
	});

	it("un agente sin nodos de nivel 2, o desconocido, no tiene ninguno", () => {
		expect(approvableNodes("soporte")).toEqual([]);
		expect(approvableNodes("")).toEqual([]);
		// "out" no es el agente "outreach": el prefijo es el dominio entero.
		expect(approvableNodes("out")).toEqual([]);
	});
});

describe("readPolicy", () => {
	it("lee la política guardada", () => {
		const config = {
			approvals: { "outreach/crm-record": "auto", "outreach/x": "once" },
		};
		expect(readPolicy(config, "outreach/crm-record")).toBe("auto");
		expect(readPolicy(config, "outreach/x")).toBe("once");
	});

	it.each([
		null,
		undefined,
		"texto",
		{},
		{ approvals: null },
		{ approvals: "auto" },
		{ approvals: { "outreach/crm-record": "nunca" } },
		{ approvals: { "outreach/crm-record": 1 } },
	])("cualquier otra cosa es always: %j", (config) => {
		expect(readPolicy(config, "outreach/crm-record")).toBe("always");
	});
});

describe("políticas", () => {
	it("cada política tiene rótulo y explicación", () => {
		for (const policy of POLICIES) {
			expect(POLICY_LABELS[policy]).toBeTruthy();
			expect(POLICY_HELP[policy]).toBeTruthy();
		}
	});

	it("'once' no promete seguir solo: en procesos automáticos equivale a always", () => {
		expect(POLICY_HELP.once).not.toMatch(/sigue solo/);
		expect(POLICY_HELP.once).toContain("procesos automáticos");
		expect(POLICY_HELP.once).toContain(`«${POLICY_LABELS.always}»`);
	});

	it("isPolicy reconoce solo las tres", () => {
		expect(POLICIES.every(isPolicy)).toBe(true);
		expect(isPolicy("nunca")).toBe(false);
		expect(isPolicy("toString")).toBe(false);
	});
});
