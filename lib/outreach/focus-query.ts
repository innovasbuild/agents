// Parser del formulario de /focos (spec etapa 13 §9.2), espejo de
// contactos-query.ts. Reusa targetCriteriaSchema (Task 6): un foco desde la
// pantalla tiene el mismo criterio que uno creado por CLI.
import { z } from "zod";
import type { ConfigValueKind } from "./config";
import { targetCriteriaSchema } from "./focus";

const numeric = z.coerce.number().int().positive();

export const focusFormSchema = z.object({
	name: z.string().trim().min(1).max(200),
	criteria: targetCriteriaSchema,
	vector: z.string().min(1).max(80),
	segment: z.string().min(1).max(80),
	hook: z.string().min(1).max(80),
	idioma: z.string().min(1).max(20),
	maxAccounts: numeric,
	maxContacts: numeric,
});

export type FocusForm = z.infer<typeof focusFormSchema>;

export function parseFocusForm(raw: unknown): FocusForm {
	return focusFormSchema.parse(raw);
}

export interface ConfigOption {
	value: string;
	label: string;
}

export type ConfigOptionsByKind = Record<ConfigValueKind, ConfigOption[]>;

/** Agrupa las filas crudas de config_values por kind, para poblar los
 * <select> del formulario de /focos. Espejo de labelsByKind en
 * metricas-query.ts, pero como el resultado que necesita esta pantalla
 * (listas por kind, no un mapa de lookup) en vez de reimplementar toMetricas. */
export function groupConfigValuesByKind(
	rows: readonly unknown[],
): ConfigOptionsByKind {
	const byKind: ConfigOptionsByKind = {
		segmento: [],
		vector: [],
		hook: [],
		idioma: [],
	};
	for (const entry of rows) {
		const row = entry as { kind?: unknown; value?: unknown; label?: unknown };
		if (typeof row.kind !== "string" || typeof row.value !== "string") continue;
		if (!(row.kind in byKind)) continue;
		byKind[row.kind as ConfigValueKind].push({
			value: row.value,
			label: typeof row.label === "string" ? row.label : row.value,
		});
	}
	return byKind;
}
