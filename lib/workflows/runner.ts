// Una pasada de un workflow para un tenant (spec orquestación §5.2 y §6.5).
// Función pura con dependencias inyectadas: el schedule dispatch.ts es una
// puerta fina que le arma las reales. Acá itera el código, nunca el modelo.
import { type BudgetStore, budgetStatus } from "./budget";
import type { TenantWorkflowConfig } from "./config";
import { type EnqueueStore, enqueue } from "./enqueue";
import { downstreamOf, NODES, WORKFLOWS } from "./registry";
import { type ItemOutcome, MAX_ATTEMPTS, type WorkItem } from "./types";

/** Espera antes del reintento N+1. Al tercer fallo no hay reintento: failed. */
export const RETRY_DELAYS_MINUTES: readonly number[] = [5, 30];

export interface RunnerStore extends EnqueueStore, BudgetStore {
	openRun(row: {
		tenantId: string;
		agent: string;
		workflow: string;
		startedAt: Date;
	}): Promise<string>;
	closeRun(
		runId: string,
		patch: {
			status: "ok" | "failed" | "budget_exhausted";
			error: string | null;
			claimed: number;
			ok: number;
			refused: number;
			failed: number;
			finishedAt: Date;
		},
	): Promise<void>;
	claim(
		tenantId: string,
		workflow: string,
		limit: number,
		leaseSeconds: number,
	): Promise<WorkItem[]>;
	finishItem(
		id: number,
		patch: {
			status: "done" | "refused";
			resultReason: string | null;
			runId: string;
		},
	): Promise<void>;
	retryItem(
		id: number,
		patch: { nextAttemptAt: Date; lastError: string; runId: string },
	): Promise<void>;
	failItem(
		id: number,
		patch: { lastError: string; runId: string },
	): Promise<void>;
	touchLastRun(tenantId: string, workflow: string, at: Date): Promise<void>;
	enabledWorkflows(tenantId: string): Promise<ReadonlySet<string>>;
	nodePolicy(
		tenantId: string,
		node: string,
	): Promise<"always" | "once" | "auto">;
}

export interface PassContext {
	tenantId: string;
	runId: string;
	workflow: string;
	optionalNodes: ReadonlySet<string>;
	/** Entrega la implementación de un nodo, o tira si el workflow no puede usarlo. */
	useNode<T>(name: string): Promise<T>;
}

export interface WorkflowImpl {
	/** Trabajo que nace del paso del tiempo y no de un evento (spec §6.2). */
	seed?(
		tenantId: string,
		now: Date,
	): Promise<{ subjectId: string; inputHash: string }[]>;
	runItem(item: WorkItem, ctx: PassContext): Promise<ItemOutcome>;
}

export interface PassResult {
	status: "ok" | "failed" | "budget_exhausted";
	claimed: number;
	ok: number;
	refused: number;
	failed: number;
	stoppedBy:
		| "sin_trabajo"
		| "tope_items"
		| "tope_costo"
		| "reloj"
		| "presupuesto";
}

function errorText(error: unknown): string {
	const text = error instanceof Error ? error.message : String(error);
	return text.slice(0, 2000);
}

export async function runWorkflowPass(
	input: {
		tenant: { id: string; timezone: string };
		workflow: string;
		config: TenantWorkflowConfig;
	},
	deps: {
		store: RunnerStore;
		impl: WorkflowImpl;
		nodes: Record<string, unknown>;
		now: () => Date;
		clockBudgetMs: number;
		leaseSeconds: number;
	},
): Promise<PassResult> {
	const { store } = deps;
	const info = WORKFLOWS[input.workflow];
	const tenantId = input.tenant.id;
	const startedAt = deps.now();

	// Si esto tira, tira la pasada: sin fila en runs no hay forma de contar
	// nada, y es preferible un error ruidoso a trabajo invisible.
	const runId = await store.openRun({
		tenantId,
		agent: info.agent,
		workflow: input.workflow,
		startedAt,
	});

	const counts = { claimed: 0, ok: 0, refused: 0, failed: 0 };
	const close = async (
		status: PassResult["status"],
		stoppedBy: PassResult["stoppedBy"],
		error: string | null,
	): Promise<PassResult> => {
		const finishedAt = deps.now();
		await store.closeRun(runId, { status, error, ...counts, finishedAt });
		await store.touchLastRun(tenantId, input.workflow, finishedAt);
		return { status, ...counts, stoppedBy };
	};

	// Desde acá (runId ya existe) todo va bajo try: si algo tira, la fila de
	// runs igual se cierra (como "failed") en vez de quedar en "running" para
	// siempre. El error se relanza después de cerrar, para que quien llama se
	// entere igual de que la pasada no terminó bien.
	let stoppedBy: PassResult["stoppedBy"] = "sin_trabajo";
	try {
		// Presupuesto antes de tocar nada: agotado, los ítems quedan intactos.
		const budgets = await budgetStatus(
			{
				tenantId,
				resources: info.resources,
				timezone: input.tenant.timezone,
			},
			{ store, now: deps.now },
		);
		const agotado = budgets.find((b) => b.exhausted);
		if (agotado) {
			return close(
				"budget_exhausted",
				"presupuesto",
				`${agotado.resource}: gastado ${agotado.spent} de ${agotado.limit}`,
			);
		}

		if (deps.impl.seed) {
			for (const seeded of await deps.impl.seed(tenantId, startedAt)) {
				await enqueue(
					{
						tenantId,
						workflow: input.workflow,
						subjectType: info.subjectType,
						...seeded,
					},
					{ store },
				);
			}
		}

		const allowed = new Set([
			...info.nodes,
			...info.optionalNodes.filter((n) => input.config.optionalNodes.has(n)),
		]);
		const ctx: PassContext = {
			tenantId,
			runId,
			workflow: input.workflow,
			optionalNodes: input.config.optionalNodes,
			async useNode<T>(name: string): Promise<T> {
				if (!allowed.has(name)) {
					throw new Error(`${input.workflow} no declara el nodo ${name}`);
				}
				const effect = NODES[name]?.effect ?? 3;
				// Defensa en profundidad: el test del registry ya lo impide en frío.
				if (effect === 3) {
					throw new Error(
						`${name} es nivel 3: un workflow desatendido no le llega a una persona`,
					);
				}
				if (
					effect === 2 &&
					(await store.nodePolicy(tenantId, name)) !== "auto"
				) {
					throw new Error(
						`${name} es nivel 2 y la política de este tenant no es auto`,
					);
				}
				if (!Object.hasOwn(deps.nodes, name)) {
					throw new Error(`falta la implementación del nodo ${name}`);
				}
				return deps.nodes[name] as T;
			},
		};

		const enabled = await store.enabledWorkflows(tenantId);

		// De a uno: así un corte por reloj, costo o tope nunca deja ítems tomados
		// sin procesar. Al volumen de diseño (spec D4) el costo extra es nulo.
		for (;;) {
			if (counts.claimed >= input.config.itemsPerTick) {
				stoppedBy = "tope_items";
				break;
			}
			if (deps.now().getTime() - startedAt.getTime() >= deps.clockBudgetMs) {
				stoppedBy = "reloj";
				break;
			}
			if (info.caps.costUsdPerRun > 0) {
				const spent = await store.usageSince(
					tenantId,
					"model_usd",
					startedAt,
					runId,
				);
				if (spent >= info.caps.costUsdPerRun) {
					stoppedBy = "tope_costo";
					break;
				}
			}

			const [item] = await store.claim(
				tenantId,
				input.workflow,
				1,
				deps.leaseSeconds,
			);
			if (!item) break;
			counts.claimed++;

			// Ítem terminado ok en este intento: se resuelve acá adentro, y recién
			// después (fuera del try de runItem) se intenta encolar el downstream.
			// Si eso último tira, el ítem ya cerró done y no debe revivir.
			let downstreamHash: string | undefined;
			let terminoOk = false;

			try {
				const outcome = await deps.impl.runItem(item, ctx);
				if (outcome.ok) {
					await store.finishItem(item.id, {
						status: "done",
						resultReason: null,
						runId,
					});
					counts.ok++;
					terminoOk = true;
					downstreamHash = outcome.downstreamHash;
				} else {
					await store.finishItem(item.id, {
						status: "refused",
						resultReason: outcome.reason,
						runId,
					});
					counts.refused++;
				}
			} catch (error) {
				counts.failed++;
				const lastError = errorText(error);
				if (item.attempts >= MAX_ATTEMPTS) {
					await store.failItem(item.id, { lastError, runId });
				} else {
					const delay =
						RETRY_DELAYS_MINUTES[item.attempts - 1] ??
						RETRY_DELAYS_MINUTES[RETRY_DELAYS_MINUTES.length - 1];
					await store.retryItem(item.id, {
						nextAttemptAt: new Date(deps.now().getTime() + delay * 60_000),
						lastError,
						runId,
					});
				}
			}

			if (terminoOk) {
				for (const next of downstreamOf(info.produces)) {
					if (!enabled.has(next)) continue;
					try {
						await enqueue(
							{
								tenantId,
								workflow: next,
								subjectType: WORKFLOWS[next].subjectType,
								subjectId: item.subjectId,
								inputHash: downstreamHash ?? item.inputHash,
							},
							{ store },
						);
					} catch (error) {
						// El ítem de origen ya cerró done: un fallo acá pierde la arista
						// downstream, nunca el trabajo ya hecho. No se toca su estado.
						console.error(
							`[runner] no se pudo encolar ${next} tras ${input.workflow}/${item.subjectId}: ${errorText(error)}`,
						);
					}
				}
			}
		}

		const cierra =
			counts.claimed === counts.ok + counts.refused + counts.failed;
		return close(
			"ok",
			stoppedBy,
			cierra
				? null
				: `la cuenta no cierra: ${counts.claimed} reclamados, ${counts.ok + counts.refused + counts.failed} resueltos`,
		);
	} catch (error) {
		await close("failed", stoppedBy, errorText(error));
		throw error;
	}
}
