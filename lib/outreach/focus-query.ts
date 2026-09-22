// Parser del formulario de /focos (spec etapa 13 §9.2), espejo de
// contactos-query.ts. Reusa targetCriteriaSchema (Task 6): un foco desde la
// pantalla tiene el mismo criterio que uno creado por CLI.
import { z } from "zod";
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
