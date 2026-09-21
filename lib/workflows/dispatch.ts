// El dispatcher (spec orquestación §6.5): un tick barre las pasadas
// abandonadas, recorre los tenants y, por cada workflow prendido al que le
// toca, corre una pasada. Función pura con dependencias inyectadas: el schedule
// agents/outreach/schedules/dispatch.ts es la puerta que le arma las reales.
// Sin lock global: el lease da exclusión por ítem. Imports relativos.
import {
	DEFAULT_CADENCE_MINUTES,
	isDue,
	parseTenantWorkflowConfig,
	type TenantWorkflowConfig,
} from "./config";
import { isWorkflow, WORKFLOWS } from "./registry";
import {
	type PassResult,
	type RunnerStore,
	runWorkflowPass,
	type WorkflowImpl,
} from "./runner";

/** Timeout de función en Vercel para este proyecto (spike S2, spec §13). */
export const FUNCTION_TIMEOUT_MS = 300_000;
/** Trabajo útil por tick, repartido entre todas las pasadas del tick. */
export const TICK_BUDGET_MS = 200_000;
/** Tope de un ítem: la puerta corta ahí la llamada al modelo. */
export const ITEM_TIMEOUT_MS = 75_000;
/** Más largo que el timeout de la función: un ítem no vence mientras quien lo
 * tomó sigue vivo, y una pasada `running` más vieja que esto está muerta. */
export const LEASE_SECONDS = 600;
/** Con menos que esto no vale la pena abrir una pasada: se perdería un turno
 * entero de cadencia sin procesar nada. Mejor dejarla para el próximo tick. */
export const MIN_PASS_MS = 10_000;

export interface DispatchStore extends RunnerStore {
	listEnabled(
		tenantId: string,
	): Promise<{ workflow: string; config: unknown; lastRunAt: string | null }[]>;
	/** Cierra como failed las pasadas de workflow `running` que arrancaron antes
	 * de `before` (spec §11). Devuelve cuántas cerró. */
	closeAbandonedRuns(before: Date, at: Date): Promise<number>;
}

export interface DispatchTenant {
	id: string;
	slug: string;
	timezone: string;
}

export interface DispatchOutcome {
	tenant: string;
	workflow: string | null;
	outcome:
		| "corrida"
		| "no_toca"
		| "sin_tiempo"
		| "desconocido"
		| "de_otro_agente"
		| "sin_implementacion"
		| "config_invalida"
		| "error";
	result?: PassResult;
	error?: string;
}

type EnabledRow = {
	workflow: string;
	config: unknown;
	lastRunAt: string | null;
};

/** Una fila a la que le toca correr, ya validada, esperando su turno en el
 * reparto del reloj de la fase 2. */
interface Candidate {
	tenant: DispatchTenant;
	row: EnabledRow;
	config: TenantWorkflowConfig;
	/** Desempate estable: el orden en que la fase 1 la encontró. */
	order: number;
}

function errorText(error: unknown): string {
	const text = error instanceof Error ? error.message : String(error);
	return text.slice(0, 2000);
}

export async function runDispatch(deps: {
	agent: string;
	store: DispatchStore;
	listTenants: () => Promise<DispatchTenant[]>;
	impls: Record<string, WorkflowImpl>;
	nodes: Record<string, unknown>;
	now: () => Date;
	tickBudgetMs?: number;
	leaseSeconds?: number;
}): Promise<DispatchOutcome[]> {
	const tickBudgetMs = deps.tickBudgetMs ?? TICK_BUDGET_MS;
	const leaseSeconds = deps.leaseSeconds ?? LEASE_SECONDS;
	const tickStart = deps.now();
	const outcomes: DispatchOutcome[] = [];

	// Una función que murió a mitad de pasada no llegó a su closeRun. Pasado el
	// lease, seguro que no sigue viva. El barrido no frena el tick.
	try {
		await deps.store.closeAbandonedRuns(
			new Date(tickStart.getTime() - leaseSeconds * 1000),
			tickStart,
		);
	} catch (error) {
		console.error(
			"dispatch: barrido de pasadas abandonadas:",
			errorText(error),
		);
	}

	// Si esto tira, tira el tick: sin tenants no hay nada que hacer.
	const tenants = await deps.listTenants();

	// Fase 1: clasifica cada fila prendida. Lo que no tiene turno (desconocido,
	// de otro agente, sin implementación, config inválida, no le toca por
	// cadencia) se resuelve acá mismo. Lo que sí tiene turno se junta en
	// `candidates` para que la fase 2 reparta el reloj del tick por antigüedad.
	const candidates: Candidate[] = [];
	let order = 0;
	for (const tenant of tenants) {
		let rows: EnabledRow[];
		try {
			rows = await deps.store.listEnabled(tenant.id);
		} catch (error) {
			outcomes.push({
				tenant: tenant.slug,
				workflow: null,
				outcome: "error",
				error: errorText(error),
			});
			continue;
		}
		for (const row of rows) {
			const base = { tenant: tenant.slug, workflow: row.workflow };
			try {
				if (!isWorkflow(row.workflow)) {
					console.warn(
						`dispatch: ${tenant.slug} tiene prendido "${row.workflow}", que no está en el registry`,
					);
					outcomes.push({ ...base, outcome: "desconocido" });
					continue;
				}
				const info = WORKFLOWS[row.workflow];
				if (info.agent !== deps.agent) {
					outcomes.push({ ...base, outcome: "de_otro_agente" });
					continue;
				}
				if (!Object.hasOwn(deps.impls, row.workflow)) {
					console.warn(
						`dispatch: ${row.workflow} está en el registry pero este dispatcher no tiene su implementación`,
					);
					outcomes.push({ ...base, outcome: "sin_implementacion" });
					continue;
				}

				const now = deps.now();
				const parsed = parseTenantWorkflowConfig(row.workflow, row.config);
				if (!parsed.ok) {
					// Sin cadencia propia, se usa la default: si no, una config rota
					// deja una pasada failed cada 5 minutos.
					if (!isDue(row.lastRunAt, DEFAULT_CADENCE_MINUTES, now)) {
						outcomes.push({ ...base, outcome: "no_toca" });
						continue;
					}
					const runId = await deps.store.openRun({
						tenantId: tenant.id,
						agent: info.agent,
						workflow: row.workflow,
						startedAt: now,
					});
					await deps.store.closeRun(runId, {
						status: "failed",
						error: parsed.message,
						claimed: 0,
						ok: 0,
						refused: 0,
						failed: 0,
						finishedAt: now,
					});
					await deps.store.touchLastRun(tenant.id, row.workflow, now);
					outcomes.push({
						...base,
						outcome: "config_invalida",
						error: parsed.message,
					});
					continue;
				}
				if (!isDue(row.lastRunAt, parsed.config.cadenceMinutes, now)) {
					outcomes.push({ ...base, outcome: "no_toca" });
					continue;
				}

				candidates.push({
					tenant,
					row,
					config: parsed.config,
					order: order++,
				});
			} catch (error) {
				outcomes.push({ ...base, outcome: "error", error: errorText(error) });
			}
		}
	}

	// Fase 2: al que hace más tiempo que no corre le toca antes (nunca corrió,
	// lastRunAt null, es el más atrasado de todos). Así, cuando hay más trabajo
	// del que entra en un tick, no son siempre los primeros de listTenants los
	// que se comen el presupuesto: con el tiempo le toca a todos. Orden
	// estable: a igual lastRunAt, gana el orden en que apareció en la fase 1.
	candidates.sort((a, b) => {
		const ta = a.row.lastRunAt
			? new Date(a.row.lastRunAt).getTime()
			: Number.NEGATIVE_INFINITY;
		const tb = b.row.lastRunAt
			? new Date(b.row.lastRunAt).getTime()
			: Number.NEGATIVE_INFINITY;
		if (ta !== tb) return ta - tb;
		return a.order - b.order;
	});

	for (const candidate of candidates) {
		const { tenant, row, config } = candidate;
		const base = { tenant: tenant.slug, workflow: row.workflow };
		try {
			const now = deps.now();
			// El reloj es del tick: cada pasada recibe lo que queda. Con menos de
			// MIN_PASS_MS no vale la pena abrir la pasada (Minor 1): le toca en el
			// próximo tick, sin tocar last_run_at.
			const remaining = tickBudgetMs - (now.getTime() - tickStart.getTime());
			if (remaining < MIN_PASS_MS) {
				outcomes.push({ ...base, outcome: "sin_tiempo" });
				continue;
			}

			const result = await runWorkflowPass(
				{
					tenant: { id: tenant.id, timezone: tenant.timezone },
					workflow: row.workflow,
					config,
				},
				{
					store: deps.store,
					impl: deps.impls[row.workflow],
					nodes: deps.nodes,
					now: deps.now,
					clockBudgetMs: remaining,
					leaseSeconds,
				},
			);
			outcomes.push({ ...base, outcome: "corrida", result });
		} catch (error) {
			// El runner ya cerró su pasada como failed antes de tirar.
			outcomes.push({ ...base, outcome: "error", error: errorText(error) });
		}
	}

	return outcomes;
}
