// Tools del brain según el binding del tenant (spec brain §3 y §4.1). Sin
// binding, el modelo no ve ninguna tool brain_*.
import { defineDynamic, defineTool } from "eve/tools";
import { always } from "eve/tools/approval";
import { z } from "zod";
import { decideBrainUpsertResponse } from "../../../lib/brain/approval";
import { toToolError } from "../../../lib/brain/errors";
import { getBrainProvider } from "../../../lib/brain/provider";
import { resolveBrainBinding } from "../../../lib/brain/resolve";
import { CANON_TAGS } from "../../../lib/brain/types";
import { loadTenantBindings } from "../../../lib/connectors/bindings";
import { createAdminClient } from "../../../lib/supabase/admin";

function attribute(value: unknown): string {
	return typeof value === "string" ? value : "";
}

const slugSchema = z
	.string()
	.max(200)
	.describe(
		"Ruta de la página, en minúsculas con guiones, por ejemplo comercial/icp.",
	);

export default defineDynamic({
	events: {
		"session.started": async (_event, ctx) => {
			const auth = ctx.session.auth.initiator ?? ctx.session.auth.current;
			const binding = await resolveBrainBinding(
				attribute(auth?.attributes?.tenantId),
				loadTenantBindings,
			);
			if (!binding) return null;

			const categories = binding.config.categories as [string, ...string[]];
			const canon = CANON_TAGS.join(", ");

			return {
				brain_search: defineTool({
					description: `Busca en el brain de este cliente: canon comercial, ICP, mensajes, voz, hooks, cuentas y producto. Usalo antes de investigar o redactar. Para canon, filtrá por tag: ${canon}. La consulta puede ir vacía si filtrás por tag o categoría.`,
					inputSchema: z.object({
						query: z.string().max(500),
						category: z.enum(categories).optional(),
						tag: z.string().max(60).optional(),
						includeArchived: z.boolean().optional(),
						limit: z.number().int().min(1).max(20).optional(),
					}),
					execute: async (input) => {
						try {
							const results = await getBrainProvider(
								binding,
								createAdminClient(),
							).search(input);
							return { ok: true as const, results };
						} catch (error) {
							return toToolError(error);
						}
					},
				}),

				brain_read: defineTool({
					description:
						"Lee una página completa del brain de este cliente, con su revisión. Necesitás la revisión para proponer cambios con brain_upsert.",
					inputSchema: z.object({ slug: slugSchema }),
					execute: async ({ slug }) => {
						try {
							const page = await getBrainProvider(
								binding,
								createAdminClient(),
							).read(slug);
							return { ok: true as const, page };
						} catch (error) {
							return toToolError(error);
						}
					},
				}),

				brain_upsert: defineTool({
					description: `Propone crear o actualizar una página del brain de este cliente. Siempre la aprueba un administrador. Para actualizar, leé la página y pasá su revisión en baseRevision; sin baseRevision solo crea páginas nuevas. Nunca borres: para retirar una página, poné status archivado. Explicá el cambio en reason. Categorías válidas: ${categories.join(", ")}. Tags de canon: ${canon}.`,
					inputSchema: z.object({
						slug: slugSchema,
						title: z.string().min(1).max(300),
						category: z.enum(categories),
						status: z.enum(["activo", "borrador", "archivado"]),
						tags: z.array(z.string().min(1).max(60)).max(20),
						body: z
							.string()
							.describe("Cuerpo completo en markdown. Reemplaza al anterior."),
						reason: z.string().min(1).max(500),
						baseRevision: z.number().int().min(1).optional(),
					}),
					approval: {
						request: always(),
						response: ({ responder }) =>
							decideBrainUpsertResponse(responder, binding.tenantId),
					},
					execute: async (input, toolCtx) => {
						const initiator = toolCtx.session.auth.initiator;
						const userId =
							initiator?.principalType === "user"
								? initiator.principalId
								: null;
						try {
							const result = await getBrainProvider(
								binding,
								createAdminClient(),
							).upsert(input, {
								kind: "agent",
								userId,
								sessionId: toolCtx.session.id,
							});
							return { ok: true as const, ...result };
						} catch (error) {
							return toToolError(error);
						}
					},
				}),
			};
		},
	},
});
