// Registro de consumo (spec orquestación §5.1 punto 9 y §7.2). Imports
// relativos: lo importan tools y schedules de eve, que no resuelven "@/".
import { gatewayCost, modelCostUsd, tokens } from "./pricing";

export interface UsageEntry {
	tenantId: string;
	runId: string | null;
	workflow: string | null;
	node: string;
	resource: string;
	amount: number;
	unit: "usd" | "credits";
	meta: Record<string, unknown>;
}

export type RecordUsage = (entry: UsageEntry) => Promise<void>;

// Lo mínimo del cliente de Supabase que se usa acá, para poder probarlo sin él.
export interface AdminLike {
	// biome-ignore lint/suspicious/noExplicitAny: forma del query builder de supabase-js
	from(table: string): any;
}

/**
 * Nunca tira: la medición no puede tumbar un turno ni una pasada (mismo
 * principio que hooks/runs.ts). Un fallo queda en el log con ruido.
 */
export function createUsageRecorder(admin: AdminLike): RecordUsage {
	return async (entry) => {
		try {
			const { error } = await admin.from("usage_entries").insert({
				tenant_id: entry.tenantId,
				run_id: entry.runId,
				workflow: entry.workflow,
				node: entry.node,
				resource: entry.resource,
				amount: entry.amount,
				unit: entry.unit,
				meta: entry.meta,
			});
			if (error) console.error("usage_entries:", error.message);
		} catch (error) {
			console.error("usage_entries:", error);
		}
	};
}

/** La fila de `runs` de un turno del chat (la abre hooks/runs.ts en turn.started). */
export async function resolveRunId(
	admin: AdminLike,
	sessionId: string,
	turnId: string | null,
): Promise<string | null> {
	if (!turnId) return null;
	const { data } = await admin
		.from("runs")
		.select("id")
		.eq("eve_session_id", sessionId)
		.eq("eve_turn_id", turnId)
		.maybeSingle();
	return (data as { id: string } | null)?.id ?? null;
}

/** Lo que consumió una llamada al modelo, en la forma que lee `modelCostUsd`. */
export interface ModelSpend {
	usage: unknown;
	providerMetadata: unknown;
}

// Symbol.for y no Symbol(): sobrevive a que este módulo se cargue dos veces
// (eve y Next empaquetan por separado).
const SPEND_ON_ERROR = Symbol.for("innovas.usage.spend");

/**
 * Cuelga del error lo que la llamada ya había consumido antes de tirar, para
 * que `metered` lo asiente igual. Devuelve el mismo error, así el servicio
 * hace `throw attachSpend(error, spend)` y quien lo ataja ve lo de siempre.
 * Sin consumo, o si el error no admite propiedades, lo deja como está.
 */
export function attachSpend(error: unknown, spend: ModelSpend | null): unknown {
	if (!spend) return error;
	if (typeof error !== "object" || error === null) return error;
	if (!Object.isExtensible(error)) return error;
	// No enumerable: no aparece en logs ni en JSON.stringify del error.
	Object.defineProperty(error, SPEND_ON_ERROR, {
		value: spend,
		configurable: true,
	});
	return error;
}

function spendFromError(error: unknown): ModelSpend | null {
	if (typeof error !== "object" || error === null) return null;
	return (
		((error as Record<symbol, unknown>)[SPEND_ON_ERROR] as ModelSpend) ?? null
	);
}

/**
 * Acumula el consumo paso a paso: `onStepEnd` va tal cual a `generateText`
 * (ai@7 lo llama al cerrar cada paso, con su `usage` y su `providerMetadata`).
 * `spend()` da el total de los pasos cerrados, o null si no cerró ninguno.
 * El costo del gateway se suma solo si lo informaron todos los pasos: con uno
 * que falte sería un costo parcial, y la tabla (que sobreestima) es más segura.
 * Un paso cortado a la mitad por un abort no llega acá: ese consumo no lo
 * informa nadie.
 */
export function createStepSpend(): {
	onStepEnd: (step: { usage: unknown; providerMetadata: unknown }) => void;
	spend: () => ModelSpend | null;
} {
	let steps = 0;
	let inputTokens = 0;
	let outputTokens = 0;
	let gatewayUsd: number | null = 0;
	return {
		onStepEnd(step) {
			steps++;
			inputTokens += tokens(step.usage, "inputTokens");
			outputTokens += tokens(step.usage, "outputTokens");
			const cost = gatewayCost(step.providerMetadata);
			gatewayUsd =
				gatewayUsd === null || cost === null ? null : gatewayUsd + cost;
		},
		spend() {
			if (steps === 0) return null;
			return {
				usage: { inputTokens, outputTokens },
				providerMetadata:
					gatewayUsd === null
						? undefined
						: { gateway: { cost: String(gatewayUsd) } },
			};
		},
	};
}

/**
 * Envuelve una función `generate` para que cada llamada al modelo deje su
 * asiento. Se aplica en la puerta (tool, schedule, runner), así los servicios
 * no conocen el libro de consumo. tests/workflows/model-calls.test.ts obliga
 * a que todo archivo que importa `generateText` lo use.
 *
 * Si la llamada tira, asienta lo que el servicio haya colgado del error con
 * `attachSpend` (tokens ya pagados que el tope y el presupuesto tienen que
 * ver) y relanza el mismo error: el runner lo necesita para reintentar.
 */
export function metered<
	A extends unknown[],
	R extends { usage?: unknown; providerMetadata?: unknown },
>(
	fn: (...args: A) => Promise<R>,
	opts: {
		model: (...args: A) => string;
		record: RecordUsage;
		base: Pick<UsageEntry, "tenantId" | "runId" | "workflow" | "node">;
	},
): (...args: A) => Promise<R> {
	const book = async (
		model: string,
		spend: { usage?: unknown; providerMetadata?: unknown },
		extra: Record<string, unknown>,
	) => {
		const cost = modelCostUsd({
			model,
			usage: spend.usage,
			providerMetadata: spend.providerMetadata,
		});
		await opts.record({
			...opts.base,
			resource: "model_usd",
			amount: cost.usd,
			unit: "usd",
			meta: {
				model,
				source: cost.source,
				inputTokens: cost.inputTokens,
				outputTokens: cost.outputTokens,
				...extra,
			},
		});
	};
	return async (...args) => {
		let result: R;
		try {
			result = await fn(...args);
		} catch (error) {
			const spend = spendFromError(error);
			if (spend) {
				// Asentar no puede tapar el error original.
				try {
					await book(opts.model(...args), spend, { failed: true });
				} catch (recordError) {
					console.error("usage_entries:", recordError);
				}
			}
			throw error;
		}
		await book(opts.model(...args), result, {});
		return result;
	};
}
