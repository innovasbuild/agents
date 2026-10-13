// Schema del frontmatter de una página de la wiki (spec etapa 25 §3.3).
import { z } from "zod";

export const CATEGORIES = [
	"indice",
	"arquitectura",
	"dominios",
	"guias",
	"referencia",
	"decisiones",
	"producto",
] as const;

const date = z
	.string()
	.regex(/^\d{4}-\d{2}-\d{2}$/, "usá el formato YYYY-MM-DD");

export const frontmatterSchema = z.object({
	title: z.string().min(1),
	category: z.enum(CATEGORIES),
	status: z.enum(["activo", "borrador", "archivado"]),
	tags: z.array(z.string()).optional(),
	updated: date.optional(),
	sources: z.array(z.string().min(1)).optional(),
	generated: z.boolean().optional(),
});

export type Frontmatter = z.infer<typeof frontmatterSchema>;

/** Qué le falta a una página además de lo que valida el schema. */
export function extraProblems(front: Frontmatter): string[] {
	const problems: string[] = [];
	if (front.generated) return problems;
	if (!front.updated) problems.push("falta `updated`");
	const sourcesOptional =
		front.category === "producto" ||
		front.category === "decisiones" ||
		front.category === "indice";
	if (!sourcesOptional && !front.sources?.length) {
		problems.push(
			"falta `sources` (obligatorio fuera de producto/ y decisiones/)",
		);
	}
	return problems;
}
