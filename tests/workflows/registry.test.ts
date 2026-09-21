import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
	downstreamOf,
	isWorkflow,
	NODES,
	SERVICES_EXCLUIDOS,
	WORKFLOWS,
} from "@/lib/workflows/registry";

// lib/<dominio>/services/<archivo>.ts  →  "<dominio>/<archivo>"
function servicesOnDisk(): string[] {
	return readdirSync("lib")
		.filter((domain) => statSync(join("lib", domain)).isDirectory())
		.flatMap((domain) => {
			const dir = join("lib", domain, "services");
			try {
				return readdirSync(dir)
					.filter((file) => file.endsWith(".ts"))
					.map((file) => `${domain}/${file.replace(/\.ts$/, "")}`);
			} catch {
				return [];
			}
		});
}

describe("registry", () => {
	it("todo servicio de lib/*/services está registrado como nodo o excluido con motivo", () => {
		// Mismo patrón que TOOL_LABELS: la tabla es a mano, así que esto falla
		// hasta que alguien decida qué nivel de efecto tiene el servicio nuevo.
		const sinDecidir = servicesOnDisk().filter(
			(name) =>
				!Object.hasOwn(NODES, name) && !Object.hasOwn(SERVICES_EXCLUIDOS, name),
		);
		expect(sinDecidir).toEqual([]);
	});

	it("no quedan nodos ni excluidos que ya no existen en el disco", () => {
		const onDisk = new Set(servicesOnDisk());
		const huerfanos = [
			...Object.keys(NODES),
			...Object.keys(SERVICES_EXCLUIDOS),
		].filter((name) => !onDisk.has(name));
		expect(huerfanos).toEqual([]);
	});

	it("todo excluido explica por qué", () => {
		const sinMotivo = Object.entries(SERVICES_EXCLUIDOS)
			.filter(([, motivo]) => motivo.trim().length < 10)
			.map(([name]) => name);
		expect(sinMotivo).toEqual([]);
	});

	it("ningún workflow referencia un nodo de nivel 3", () => {
		// Un workflow desatendido nunca le llega a una persona de afuera
		// (spec §5.2 punto 6). Lo más lejos que llega es dejar una pieza pending.
		const culpables = Object.entries(WORKFLOWS).flatMap(([name, wf]) =>
			[...wf.nodes, ...wf.optionalNodes]
				.filter((node) => NODES[node]?.effect === 3)
				.map((node) => `${name} → ${node}`),
		);
		expect(culpables).toEqual([]);
	});

	it("todo nodo que un workflow referencia existe", () => {
		const inexistentes = Object.entries(WORKFLOWS).flatMap(([name, wf]) =>
			[...wf.nodes, ...wf.optionalNodes]
				.filter((node) => !Object.hasOwn(NODES, node))
				.map((node) => `${name} → ${node}`),
		);
		expect(inexistentes).toEqual([]);
	});

	it("un workflow con nodos que gastan declara tope de costo y sus recursos", () => {
		const sinTope = Object.entries(WORKFLOWS)
			.filter(([, wf]) =>
				[...wf.nodes, ...wf.optionalNodes].some(
					(node) => (NODES[node]?.effect ?? 0) >= 1,
				),
			)
			.filter(
				([, wf]) => !(wf.caps.costUsdPerRun > 0) || wf.resources.length === 0,
			)
			.map(([name]) => name);
		expect(sinTope).toEqual([]);
	});

	it("todo claims tiene quién lo produzca, o declara que entra por sembrador o por puerta", () => {
		const produced = new Set(
			Object.values(WORKFLOWS)
				.map((wf) => wf.produces)
				.filter((p): p is string => p !== null),
		);
		const huerfanos = Object.entries(WORKFLOWS)
			.filter(([, wf]) => wf.entry === "upstream" && !produced.has(wf.claims))
			.map(([name]) => name);
		expect(huerfanos).toEqual([]);
	});

	it("isWorkflow no se deja engañar por el prototipo", () => {
		expect(isWorkflow("refresh-fichas")).toBe(true);
		expect(isWorkflow("constructor")).toBe(false);
		expect(isWorkflow("no-existe")).toBe(false);
	});

	it("downstreamOf devuelve los workflows que reclaman lo que otro deja", () => {
		expect(downstreamOf(null)).toEqual([]);
		expect(downstreamOf("etiqueta-que-nadie-reclama")).toEqual([]);
	});

	it("un workflow con tope de costo por pasada mide model_usd, que es lo que ese tope mira", () => {
		// El runner corta la pasada con usage_sum(..., "model_usd", ..., runId): un
		// tope en USD sobre un workflow que no gasta modelo nunca dispararía.
		const culpables = Object.entries(WORKFLOWS)
			.filter(
				([, wf]) =>
					wf.caps.costUsdPerRun > 0 && !wf.resources.includes("model_usd"),
			)
			.map(([name]) => name);
		expect(culpables).toEqual([]);
	});
});
