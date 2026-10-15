// Contrato de las tres tools del brain (spec etapa 11 §8.1). Lo usan las tools
// del agente y el endpoint MCP: un cambio acá cambia las dos superficies.
import { z } from "zod";
import {
	BRAIN_STATUSES,
	type BrainStatus,
	CANON_TAGS,
	MAX_SLUG_LENGTH,
} from "./types.ts";

export const BRAIN_TOOL_NAMES = {
	search: "brain_search",
	read: "brain_read",
	upsert: "brain_upsert",
	rules: "brain_rules",
} as const;

const statusSchema = z.enum(BRAIN_STATUSES as [BrainStatus, ...BrainStatus[]]);

const slugSchema = z
	.string()
	.max(MAX_SLUG_LENGTH)
	.describe(
		"Ruta de la página, en minúsculas con guiones, por ejemplo comercial/icp.",
	);

const canon = CANON_TAGS.join(", ");

export function brainContract(
	categories: string[],
	// Sin canon cuando la empresa no tiene un agente que lo use (spec 21.4 §4.3).
	{ canon: withCanon = true }: { canon?: boolean } = {},
) {
	if (categories.length === 0) {
		throw new Error("el brain necesita al menos una categoría");
	}
	const category = z.enum(categories as [string, ...string[]]);
	const valid = `Categorías válidas: ${categories.join(", ")}.`;

	return {
		search: {
			description: withCanon
				? `Busca en el brain de este cliente: canon comercial, ICP, mensajes, voz, hooks, cuentas y producto. Para canon, filtrá por tag: ${canon}. La consulta puede ir vacía si filtrás por tag o categoría.`
				: `Busca en el brain de esta empresa por texto, categoría o tag. La consulta puede ir vacía si filtrás por tag o categoría. ${valid}`,
			input: z.object({
				query: z.string().max(500),
				category: category.optional(),
				tag: z.string().max(60).optional(),
				includeArchived: z.boolean().optional(),
				limit: z.number().int().min(1).max(20).optional(),
			}),
		},
		read: {
			description:
				"Lee una página completa del brain de esta empresa, con su revisión. Necesitás la revisión para actualizarla con brain_upsert. Trae también rules: las reglas de su carpeta (las instrucciones de la raíz ya llegaron al arrancar) y rules.revision, que pasás como rulesRevision si después la actualizás.",
			input: z.object({ slug: slugSchema }),
		},
		upsert: {
			description: `Crea o actualiza una página del brain de esta empresa. Para actualizar, leé la página y pasá su revisión en baseRevision; sin baseRevision solo crea páginas nuevas. Nunca borres: para retirar una página, poné status archivado. Explicá el cambio en reason. Si la ruta tiene reglas, pasá rulesRevision (viene en brain_read, en brain_rules o en el rechazo): sin él, o con uno viejo, no se escribe nada y la respuesta es rules_required con las reglas completas; leelas, ajustá la página si hace falta y reintentá con ese rulesRevision. Las páginas 00-reglas y 00-plantilla las escribe solo quien administra su carpeta; la 00-reglas de la raíz se guarda con la categoría brain. ${valid}${withCanon ? ` Tags de canon: ${canon}.` : ""}`,
			input: z.object({
				slug: slugSchema,
				title: z.string().min(1).max(300),
				category,
				status: statusSchema,
				tags: z.array(z.string().min(1).max(60)).max(20),
				body: z
					.string()
					.describe("Cuerpo completo en markdown. Reemplaza al anterior."),
				reason: z.string().min(1).max(500),
				baseRevision: z.number().int().min(1).optional(),
				rulesRevision: z.string().max(64).optional(),
			}),
		},
		rules: {
			description:
				"Devuelve las instrucciones del brain y las reglas que aplican a una ruta, de la raíz a su carpeta, con el rulesRevision que pide brain_upsert. Pasá la ruta de la página que vas a crear o editar, aunque todavía no exista. Usalo antes de crear una página nueva.",
			input: z.object({
				path: z
					.string()
					.max(MAX_SLUG_LENGTH)
					.describe(
						"Ruta de la página, por ejemplo equipo/ana-perez. Vacía para las instrucciones de la raíz.",
					),
			}),
		},
	};
}

const summarySchema = z.object({
	slug: z.string(),
	title: z.string(),
	category: z.string(),
	status: statusSchema,
	tags: z.array(z.string()),
	snippet: z.string(),
	updatedAt: z.string(),
});

const pageSchema = summarySchema.omit({ snippet: true }).extend({
	frontmatter: z.record(z.string(), z.unknown()),
	body: z.string(),
	revision: z.number().int(),
});

export const brainResultSchemas = {
	search: z.object({ ok: z.literal(true), results: z.array(summarySchema) }),
	read: z.object({ ok: z.literal(true), page: pageSchema }),
	upsert: z.object({
		ok: z.literal(true),
		slug: z.string(),
		revision: z.number().int(),
	}),
};
