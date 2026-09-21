// Tipos compartidos de la orquestación (spec §5 y §9). Sin imports: lo usan
// el registry, el runner y los módulos de eve.

/** También vive en SQL, en claim_work_items. Si cambia uno, cambia el otro. */
export const MAX_ATTEMPTS = 3;

/** Spec §7: 0 base propia · 1 gasta plata · 2 escribe en sistemas del tenant · 3 le llega a una persona. */
export type EffectLevel = 0 | 1 | 2 | 3;
export type ModelTier = "barato" | "medio" | "fuerte";

export interface NodeInfo {
	effect: EffectLevel;
	tier: ModelTier | null;
}

export interface WorkflowInfo {
	/** Agente dueño: el schedule que lo despacha vive en su carpeta. */
	agent: string;
	subjectType: string;
	/** Etiquetas del grafo: qué reclama y qué deja. */
	claims: string;
	produces: string | null;
	nodes: readonly string[];
	optionalNodes: readonly string[];
	/** Recursos medidos que gasta: contra estos se chequea el presupuesto diario. */
	resources: readonly string[];
	caps: { itemsPerTick: number; costUsdPerRun: number };
	/** De dónde le llega el trabajo: un sembrador propio, una puerta, u otro workflow. */
	entry: "seed" | "door" | "upstream";
}

export interface WorkItem {
	id: number;
	tenantId: string;
	workflow: string;
	subjectType: string;
	subjectId: string;
	inputHash: string;
	attempts: number;
}

/** Lo que devuelve procesar un ítem. Una excepción es infraestructura caída y se reintenta. */
export type ItemOutcome =
	| { ok: true; downstreamHash?: string }
	| { ok: false; reason: string; message: string };
