// Puerta del nodo outreach/research (spec orquestación §9.4): arma el caller y
// las deps reales, y llama a researchAccount. Imports relativos: eve no
// resuelve los paths de tsconfig.
import { generateText } from "ai";
import { defineTool } from "eve/tools";
import { z } from "zod";
import { normalizeDomain } from "../../../lib/outreach/domain";
import { generateResearch } from "../../../lib/outreach/services/generate-research";
import { researchAccount } from "../../../lib/outreach/services/research";
import { researchFailure } from "../../../lib/outreach/services/research-run";
import { callerFromSession } from "../../../lib/outreach/session";
import { createSupabaseOutreachStore } from "../../../lib/outreach/store";
import { fetchPublicPage, resolveHost } from "../../../lib/outreach/web-page";
import { createAdminClient } from "../../../lib/supabase/admin";
import {
	createUsageRecorder,
	metered,
	resolveRunId,
} from "../../../lib/workflows/usage";

// Sin approval: escribe solo en la base de la plataforma y lee páginas públicas.
export default defineTool({
	description:
		"Investiga la empresa de un dominio leyendo su web y guarda la ficha 90 días. Si ya hay ficha vigente la devuelve sin costo. Cada hecho trae su URL; si no hay ninguno con fuente, no hay ancla para escribir.",
	inputSchema: z.object({
		domain: z.string().min(3).max(300),
		name: z.string().max(300).optional(),
	}),
	async execute(input, ctx) {
		const caller = callerFromSession(ctx.session);
		const admin = createAdminClient();
		try {
			// `turn.id` es el mismo que hooks/runs.ts guarda en runs.eve_turn_id.
			const runId = await resolveRunId(
				admin,
				ctx.session.id,
				ctx.session.turn.id,
			);
			return await researchAccount(
				{
					tenantId: caller.tenantId,
					userId: caller.userId,
					domain: input.domain,
					name: input.name ?? null,
				},
				{
					store: createSupabaseOutreachStore(admin),
					now: () => new Date(),
					readPage: (url) =>
						fetchPublicPage(url, { fetchImpl: fetch, resolveHost }),
					generate: metered(
						(args: Parameters<typeof generateResearch>[0]) =>
							generateResearch(args, {
								generateText,
								abortSignal: ctx.abortSignal,
							}),
						{
							model: (args) => args.model,
							record: createUsageRecorder(admin),
							base: {
								tenantId: caller.tenantId,
								runId,
								workflow: null,
								node: "outreach/research",
							},
						},
					),
				},
			);
		} catch (error) {
			// Para el agente, una caída es una negativa citable, no un stack.
			return researchFailure(
				normalizeDomain(input.domain) ?? input.domain,
				error,
			);
		}
	},
});
