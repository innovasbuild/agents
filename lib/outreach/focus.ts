// El foco de búsqueda (spec etapa 13 §6). Import relativo: lo usan servicios
// que terminan importados desde agents/.
import { z } from "zod";
import type { TargetCriteria } from "../connectors/leads/adapter";

/** Apollo espera "min,max". Un formato distinto no filtra: trae de más. */
const EMPLOYEE_RANGE = /^\d{1,7},\d{1,7}$/;

export const targetCriteriaSchema = z
	.object({
		employeeRanges: z.array(z.string().regex(EMPLOYEE_RANGE)).default([]),
		locations: z.array(z.string().min(2).max(200)).default([]),
		keywords: z.array(z.string().min(2).max(100)).default([]),
		titles: z.array(z.string().min(2).max(100)).default([]),
	})
	.refine(
		(criteria) =>
			criteria.employeeRanges.length +
				criteria.locations.length +
				criteria.keywords.length >
			0,
		"un foco sin filtros de empresa traería el universo entero",
	);

export function parseTargetCriteria(raw: unknown): TargetCriteria {
	return targetCriteriaSchema.parse(raw ?? {});
}

/** Cada página de resultados es un ítem propio del workflow. */
export function focusPageHash(focusId: string, page: number): string {
	return `${focusId}:p${page}`;
}
