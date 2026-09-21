// Config de un workflow para un tenant (spec orquestación §10.1). Se valida
// con ruido: una config rota apaga ese workflow para ese tenant y avisa, nunca
// corre con valores adivinados.
import { z } from "zod";
import { isWorkflow, WORKFLOWS } from "./registry";

const DEFAULT_CADENCE_MINUTES = 60;

const platformSchema = z.looseObject({
	cadence_minutes: z.number().int().min(5).max(10_080).optional(),
	items_per_tick: z.number().int().min(1).optional(),
	optional_nodes: z.array(z.string().min(1).max(100)).optional(),
});

export interface TenantWorkflowConfig {
	cadenceMinutes: number;
	itemsPerTick: number;
	optionalNodes: ReadonlySet<string>;
	/** Todo lo que no es de la plataforma: parámetros propios del workflow. */
	params: Record<string, unknown>;
}

export type ConfigResult =
	| { ok: true; config: TenantWorkflowConfig }
	| { ok: false; reason: string; message: string };

export function parseTenantWorkflowConfig(
	workflow: string,
	raw: unknown,
): ConfigResult {
	if (!isWorkflow(workflow)) {
		return {
			ok: false,
			reason: "workflow_desconocido",
			message: `"${workflow}" no está en el registry`,
		};
	}
	const info = WORKFLOWS[workflow];
	const parsed = platformSchema.safeParse(raw ?? {});
	if (!parsed.success) {
		return {
			ok: false,
			reason: "config_invalida",
			message: `config de ${workflow} inválida: ${parsed.error.issues
				.map((issue) => `${issue.path.join(".")}: ${issue.message}`)
				.join("; ")}`,
		};
	}
	const { cadence_minutes, items_per_tick, optional_nodes, ...params } =
		parsed.data;

	const desconocidos = (optional_nodes ?? []).filter(
		(node) => !info.optionalNodes.includes(node),
	);
	if (desconocidos.length > 0) {
		return {
			ok: false,
			reason: "nodo_opcional_desconocido",
			message: `${workflow} no admite estos nodos opcionales: ${desconocidos.join(", ")}`,
		};
	}

	return {
		ok: true,
		config: {
			cadenceMinutes: cadence_minutes ?? DEFAULT_CADENCE_MINUTES,
			itemsPerTick: Math.min(
				items_per_tick ?? info.caps.itemsPerTick,
				info.caps.itemsPerTick,
			),
			optionalNodes: new Set(optional_nodes ?? []),
			params,
		},
	};
}

export function isDue(
	lastRunAt: string | null,
	cadenceMinutes: number,
	now: Date,
): boolean {
	if (!lastRunAt) return true;
	const last = new Date(lastRunAt).getTime();
	if (Number.isNaN(last)) return true;
	return now.getTime() - last >= cadenceMinutes * 60_000;
}
