import { describe, expect, it } from "vitest";
import { buildConnectables } from "@/lib/connect/connectables";

const base = {
	slug: "acme",
	publicUrl: "https://app.test",
	hasBrain: true,
	enabledAgents: ["outreach"],
};

describe("buildConnectables", () => {
	it("con brain y un agente: brain, agente y herramientas, en ese orden", () => {
		const list = buildConnectables(base);

		expect(list.map((c) => c.kind)).toEqual(["brain", "agent", "tools"]);
		expect(list[0]).toMatchObject({
			kind: "brain",
			id: "brain-acme",
			url: "https://app.test/brain/acme/mcp",
		});
		expect(list[1]).toMatchObject({
			kind: "agent",
			agent: "outreach",
			id: "outreach-acme",
			name: "Agente de outreach",
			url: "https://app.test/eve/outreach/v1/mcp?tenant=acme",
		});
	});

	it("sin brain no hay tarjeta de brain", () => {
		const list = buildConnectables({ ...base, hasBrain: false });
		expect(list.map((c) => c.kind)).toEqual(["agent", "tools"]);
	});

	it("sin agentes ni brain queda solo la tarjeta de herramientas", () => {
		const list = buildConnectables({
			...base,
			hasBrain: false,
			enabledAgents: [],
		});
		expect(list.map((c) => c.kind)).toEqual(["tools"]);
	});

	it("la tarjeta de herramientas siempre está, sin URL y marcada como próxima", () => {
		const tools = buildConnectables(base).at(-1);
		expect(tools).toMatchObject({ kind: "tools", soon: true });
		expect(tools).not.toHaveProperty("url");
	});

	it("dos agentes salen en el orden recibido", () => {
		const list = buildConnectables({
			...base,
			enabledAgents: ["soporte", "outreach"],
		});
		expect(list.flatMap((c) => (c.kind === "agent" ? [c.agent] : []))).toEqual([
			"soporte",
			"outreach",
		]);
	});

	it("un agente fuera del mapa usa su identificador y un texto genérico", () => {
		const [agent] = buildConnectables({
			...base,
			hasBrain: false,
			enabledAgents: ["soporte"],
		});
		expect(agent).toMatchObject({
			name: "soporte",
			description: "Agente de tu empresa.",
		});
	});

	it("la barra final de publicUrl no duplica barras", () => {
		const list = buildConnectables({
			...base,
			publicUrl: "https://app.test/",
		});
		expect(list[0]).toMatchObject({ url: "https://app.test/brain/acme/mcp" });
	});

	it("la URL del brain nunca lleva ?tenant", () => {
		const [brain] = buildConnectables(base);
		expect(brain.kind === "brain" && brain.url).not.toContain("?");
	});

	it("un nombre de agente raro: id saneado y URL codificada", () => {
		const [agent] = buildConnectables({
			...base,
			hasBrain: false,
			enabledAgents: ['Post Venta "2"'],
		});
		expect(agent).toMatchObject({
			kind: "agent",
			id: "post-venta-2-acme",
			url: "https://app.test/eve/Post%20Venta%20%222%22/v1/mcp?tenant=acme",
		});
	});
	it("un agente cuyo nombre se sanea a vacío no deja un id que empiece con guion", () => {
		const ids = buildConnectables({
			...base,
			hasBrain: false,
			enabledAgents: ["!!!", "ñandú"],
		}).flatMap((c) => (c.kind === "agent" ? [c.id] : []));

		for (const id of ids) expect(id).toMatch(/^[a-z0-9][a-z0-9-]*$/);
	});

	it("dos agentes que se sanean igual no comparten id", () => {
		const ids = buildConnectables({
			...base,
			hasBrain: false,
			enabledAgents: ["Ventas", "ventas"],
		}).flatMap((c) => (c.kind === "agent" ? [c.id] : []));

		expect(new Set(ids).size).toBe(2);
	});

	it("un agente llamado brain no pisa el id del brain", () => {
		const list = buildConnectables({ ...base, enabledAgents: ["brain"] });
		const ids = list.flatMap((c) => (c.kind === "tools" ? [] : [c.id]));

		expect(ids[0]).toBe("brain-acme");
		expect(new Set(ids).size).toBe(ids.length);
	});
});
