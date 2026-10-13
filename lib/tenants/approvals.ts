// Política de aprobaciones de nivel 2 (docs/arquitectura/orquestacion.md §4 y spec 21.2
// S12). El registro de nodos es la única fuente de qué paso admite política:
// los de effect 2. Un nodo de nivel 3 nunca aparece: lleva aprobación humana
// siempre. Solo importa datos planos: lo usan componentes cliente.
import { NODES } from "../workflows/registry";

export const POLICIES = ["always", "once", "auto"] as const;
export type Policy = (typeof POLICIES)[number];

export const POLICY_LABELS: Record<Policy, string> = {
	always: "Siempre pedir",
	once: "Pedir la primera vez",
	auto: "Sin pedir",
};

export const POLICY_HELP: Record<Policy, string> = {
	always: "El agente espera a que una persona lo apruebe cada vez.",
	once: "Hoy, en los procesos automáticos equivale a «Siempre pedir»: una persona lo aprueba cada vez.",
	auto: "Lo hace solo, también en los procesos automáticos.",
};

export function isPolicy(value: string): value is Policy {
	return (POLICIES as readonly string[]).includes(value);
}

/** Nodos de nivel 2 cuyo dominio es exactamente ese agente, en orden estable. */
export function approvableNodes(agent: string): string[] {
	if (!agent) return [];
	const prefix = `${agent}/`;
	return Object.entries(NODES)
		.filter(([name, info]) => name.startsWith(prefix) && info.effect === 2)
		.map(([name]) => name)
		.sort();
}

/** Misma regla que nodePolicy en lib/workflows/store.ts: todo lo demás es always. */
export function readPolicy(config: unknown, node: string): Policy {
	const approvals =
		config && typeof config === "object"
			? (config as { approvals?: unknown }).approvals
			: null;
	const value =
		approvals && typeof approvals === "object"
			? (approvals as Record<string, unknown>)[node]
			: null;
	return value === "auto" || value === "once" ? value : "always";
}
