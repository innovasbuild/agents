// El embudo de /pipeline. La escalera de outreach tiene diez etapas, pero
// `sin_atribucion` no es un escalón: es un contacto que llegó por otro lado y
// no se le atribuye el primer toque. Se cuenta aparte para que los porcentajes
// del embudo no mientan.
import { OUTREACH_STAGES, type OutreachStage } from "./stage";

/** Días de `last_touch_at` que cuentan como movimiento reciente. */
export const RECENT_DAYS = 7;

const DAY_MS = 86_400_000;

export const FUNNEL_STAGES = OUTREACH_STAGES.filter(
	(stage) => stage !== "sin_atribucion",
);

export interface FunnelStep {
	stage: OutreachStage;
	count: number;
	/** Porcentaje sobre el total de la escalera, redondeado. */
	percent: number;
	/** Contactos con un toque en los últimos RECENT_DAYS días. */
	recent: number;
}

export interface Funnel {
	steps: FunnelStep[];
	/** Contactos en la escalera. No incluye `sin_atribucion`. */
	total: number;
	sinAtribucion: number;
}

const isFunnelStage = (value: unknown): value is OutreachStage =>
	typeof value === "string" &&
	(FUNNEL_STAGES as readonly string[]).includes(value);

export function toFunnel(raw: readonly unknown[], now: Date): Funnel {
	const cutoff = now.getTime() - RECENT_DAYS * DAY_MS;
	const counts = new Map<OutreachStage, { count: number; recent: number }>();
	let total = 0;
	let sinAtribucion = 0;

	for (const entry of raw) {
		const row = entry as { stage?: unknown; last_touch_at?: unknown };
		if (row.stage === "sin_atribucion") {
			sinAtribucion += 1;
			continue;
		}
		// Una etapa que no conocemos no se inventa un escalón ni infla el total:
		// el enum de la base y esta lista podrían desincronizarse en una migración.
		if (!isFunnelStage(row.stage)) continue;

		total += 1;
		const bucket = counts.get(row.stage) ?? { count: 0, recent: 0 };
		bucket.count += 1;
		const touched =
			typeof row.last_touch_at === "string"
				? Date.parse(row.last_touch_at)
				: Number.NaN;
		if (!Number.isNaN(touched) && touched >= cutoff) bucket.recent += 1;
		counts.set(row.stage, bucket);
	}

	return {
		total,
		sinAtribucion,
		steps: FUNNEL_STAGES.map((stage) => {
			const bucket = counts.get(stage) ?? { count: 0, recent: 0 };
			return {
				stage,
				count: bucket.count,
				percent: total === 0 ? 0 : Math.round((bucket.count / total) * 100),
				recent: bucket.recent,
			};
		}),
	};
}
