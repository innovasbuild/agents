// Estado efectivo del research (spec 27 §5.2). Una corrida que quedó en
// `running` sin que nadie la termine (el proceso de fondo murió) no se espera
// para siempre: pasados 3 minutos se lee como error y la pantalla pide el dato
// a la persona. Puro. Imports relativos: lo usan módulos de eve.
import type { ResearchRow } from "./research-store";

export const RUNNING_TIMEOUT_MS = 3 * 60_000;

export function effectiveResearchStatus(
	row: Pick<ResearchRow, "status" | "updatedAt">,
	now: Date = new Date(),
): ResearchRow["status"] {
	if (row.status !== "running") return row.status;
	const age = now.getTime() - new Date(row.updatedAt).getTime();
	return age > RUNNING_TIMEOUT_MS ? "error" : "running";
}

export function effectiveResearch(
	row: ResearchRow,
	now: Date = new Date(),
): ResearchRow {
	return effectiveResearchStatus(row, now) === row.status
		? row
		: { ...row, status: "error", error: "tiempo_agotado" };
}

export type CarpetasView = {
	view: "investigando" | "sin-sitio" | "propuesta";
	/** SinSitio avisa que no se pudo leer el sitio. */
	note: boolean;
};

/**
 * Qué pantalla muestra el paso de carpetas. Sin fila no se espera para
 * siempre: si ensureResearch falló, o pasaron 3 minutos sin fila, se pide el
 * dato a la persona.
 */
export function decideCarpetasView(input: {
	research: ResearchRow | null;
	ensureFailed: boolean;
	nullSince: number;
	now: Date;
}): CarpetasView {
	const { research, now } = input;
	if (!research) {
		const stuck =
			input.ensureFailed ||
			now.getTime() - input.nullSince > RUNNING_TIMEOUT_MS;
		return stuck
			? { view: "sin-sitio", note: true }
			: { view: "investigando", note: false };
	}
	const status = effectiveResearchStatus(research, now);
	if (status === "running") return { view: "investigando", note: false };
	if (status === "error") return { view: "sin-sitio", note: true };
	if (research.result && (research.result.found || research.hint))
		return { view: "propuesta", note: false };
	return { view: "sin-sitio", note: !research.result };
}
