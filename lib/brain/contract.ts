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
} as const;

const statusSchema = z.enum(BRAIN_STATUSES as [BrainStatus, ...BrainStatus[]]);

const slugSchema = z
	.string()
	.max(MAX_SLUG_LENGTH)
	.describe(
		"Ruta de la página, en minúsculas con guiones, por ejemplo comercial/icp.",
	);

const canon = CANON_TAGS.join(", ");

export function brainContract(categories: string[]) {
	if (categories.length === 0) {
		throw new Error("el brain necesita al menos una categoría");
	}
	const category = z.enum(categories as [string, ...string[]]);

	return {
		search: {
			description: `Busca en el brain de este cliente: canon comercial, ICP, mensajes, voz, hooks, cuentas y producto. Para canon, filtrá por tag: ${canon}. La consulta puede ir vacía si filtrás por tag o categoría.`,
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
				"Lee una página completa del brain de este cliente, con su revisión. Necesitás la revisión para actualizarla con brain_upsert.",
			input: z.object({ slug: slugSchema }),
		},
		upsert: {
			description: `Crea o actualiza una página del brain de este cliente. Para actualizar, leé la página y pasá su revisión en baseRevision; sin baseRevision solo crea páginas nuevas. Nunca borres: para retirar una página, poné status archivado. Explicá el cambio en reason. Categorías válidas: ${categories.join(", ")}. Tags de canon: ${canon}.`,
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
