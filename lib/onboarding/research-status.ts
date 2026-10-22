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
