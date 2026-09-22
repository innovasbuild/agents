// El grafo de la plataforma, entero, en un lugar (spec orquestación §9.1).
// Objeto plano a propósito: sin framework ni defineNode(). Los tests de
// tests/workflows/registry.test.ts lo comparan contra el disco y fallan hasta
// que alguien decida.
import type { NodeInfo, WorkflowInfo } from "./types";

// Clave: "<dominio>/<archivo>" de lib/<dominio>/services/<archivo>.ts
export const NODES: Record<string, NodeInfo> = {
	"outreach/import-contacts": { effect: 0, tier: null },
	"outreach/research": { effect: 1, tier: "barato" },
	"outreach/draft": { effect: 1, tier: "fuerte" },
	"outreach/queue": { effect: 0, tier: null },
	// Le llega a una persona: nunca desde un workflow desatendido.
	"outreach/send": { effect: 3, tier: null },
	// Escribe en el CRM del tenant.
	"outreach/crm-record": { effect: 2, tier: null },
	// Lee Gmail y registra hechos en la base propia; no gasta ni escribe afuera.
	"outreach/sweep": { effect: 0, tier: null },
	"outreach/reconcile": { effect: 0, tier: null },
	"outreach/replies": { effect: 0, tier: null },
	// Encola follow-ups redactando con el modelo: gasta.
	"outreach/followups": { effect: 1, tier: "medio" },
	// Gasta créditos de Apollo, no tokens de modelo.
	"outreach/target-search": { effect: 1, tier: null },
	// Tres preguntas a Jev sobre lo que la búsqueda ya trajo gratis. Modelo fijo:
	// no elige entre el tier variable de `models`.
	"outreach/icp-score": { effect: 1, tier: null, model: "typesafe-ai/jev" },
	// Gasta un crédito de Apollo por cabeza, igual que target-search.
	"outreach/reveal-email": { effect: 1, tier: null },
};

export const SERVICES_EXCLUIDOS: Record<string, string> = {
	"outreach/executor":
		"helper que resuelve el ejecutor y valida atribución; no es un trabajo por sí mismo",
	"outreach/research-run":
		"arma la investigación del nodo outreach/research (prompt y tope de páginas); se registra junto con él",
	"outreach/generate-research":
		"la llamada al modelo del nodo outreach/research; se registra junto con él",
	"outreach/generate-draft":
		"la llamada al modelo del nodo outreach/draft; se registra junto con él",
	"outreach/evaluate":
		"lectura defensiva de las respuestas de Jev que usa outreach/icp-score; se registra junto con él",
};

export const WORKFLOWS: Record<string, WorkflowInfo> = {
	"refresh-fichas": {
		agent: "outreach",
		subjectType: "account",
		claims: "ficha_vencida",
		produces: "ficha_vigente",
		nodes: ["outreach/research"],
		optionalNodes: [],
		resources: ["model_usd"],
		caps: { itemsPerTick: 5, costUsdPerRun: 1 },
		entry: "seed",
	},
	"target-search": {
		agent: "outreach",
		subjectType: "search_focus",
		claims: "foco_activo",
		produces: "contacto_descubierto",
		nodes: ["outreach/target-search"],
		optionalNodes: [],
		resources: ["apollo_credits"],
		caps: { itemsPerTick: 2, costUsdPerRun: 0 },
		entry: "seed",
	},
	"icp-scoring": {
		agent: "outreach",
		subjectType: "contact",
		claims: "contacto_descubierto",
		produces: "contacto_calificado",
		nodes: ["outreach/icp-score"],
		optionalNodes: [],
		resources: ["model_usd"],
		caps: { itemsPerTick: 20, costUsdPerRun: 0.5 },
		entry: "upstream",
	},
	"contact-enrichment": {
		agent: "outreach",
		subjectType: "contact",
		claims: "contacto_calificado",
		produces: "contacto_listo",
		nodes: ["outreach/reveal-email", "outreach/research"],
		optionalNodes: [],
		resources: ["apollo_credits", "model_usd"],
		caps: { itemsPerTick: 10, costUsdPerRun: 0.3 },
		entry: "upstream",
	},
};

export function isWorkflow(name: string): boolean {
	return Object.hasOwn(WORKFLOWS, name);
}

/** Workflows que reclaman lo que otro deja. El runner encola para estos al terminar un ítem. */
export function downstreamOf(produces: string | null): string[] {
	if (produces === null) return [];
	return Object.entries(WORKFLOWS)
		.filter(([, wf]) => wf.claims === produces)
		.map(([name]) => name);
}
