// Registro de consumo (spec orquestación §5.1 punto 9 y §7.2). Imports
// relativos: lo importan tools y schedules de eve, que no resuelven "@/".
import { modelCostUsd } from "./pricing";

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

/**
 * Envuelve una función `generate` para que cada llamada al modelo deje su
 * asiento. Se aplica en la puerta (tool, schedule, runner), así los servicios
 * no conocen el libro de consumo. tests/workflows/model-calls.test.ts obliga
 * a que todo archivo que importa `generateText` lo use.
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
	return async (...args) => {
		const result = await fn(...args);
		const model = opts.model(...args);
		const cost = modelCostUsd({
			model,
			usage: result.usage,
			providerMetadata: result.providerMetadata,
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
			},
		});
		return result;
	};
}
