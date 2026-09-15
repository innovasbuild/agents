import { defineWorkflowTool } from "eve/tools";
import { z } from "zod";
import { toAgentOutputSchema } from "../../../lib/outreach/agent-schema";
import { fichaSchema } from "../../../lib/outreach/ficha";
import {
	prepareResearch,
	saveResearch,
} from "../../../lib/outreach/services/research";
import { callerFromSession } from "../../../lib/outreach/session";
import { createSupabaseOutreachStore } from "../../../lib/outreach/store";
import { createAdminClient } from "../../../lib/supabase/admin";

async function prepareStep(
	tenantId: string,
	domain: string,
	name: string | null,
) {
	"use step";
	return prepareResearch(
		{ tenantId, domain, name },
		{
			store: createSupabaseOutreachStore(createAdminClient()),
			now: () => new Date(),
		},
	);
}

async function saveStep(
	tenantId: string,
	userId: string,
	domain: string,
	raw: unknown,
) {
	"use step";
	return saveResearch(
		{ tenantId, userId, domain, raw },
		{
			store: createSupabaseOutreachStore(createAdminClient()),
			now: () => new Date(),
		},
	);
}

export default defineWorkflowTool({
	description:
		"Investiga la empresa de un dominio con el subagente researcher y guarda la ficha 90 días. Si ya hay ficha vigente la devuelve sin costo. Cada hecho trae su URL; si no hay ninguno con fuente, no hay ancla para escribir.",
	inputSchema: z.object({
		domain: z.string().min(3).max(300),
		name: z.string().max(300).optional(),
	}),
	async execute(input, ctx) {
		"use workflow";
		const caller = callerFromSession(ctx.session);
		const prepared = await prepareStep(
			caller.tenantId,
			input.domain,
			input.name ?? null,
		);
		if (prepared.kind === "done") return prepared.result;
		const raw = await ctx.agent("researcher", {
			message: prepared.message,
			// El tipo de eve no acepta el objeto de zod; el resultado se valida con zod en saveStep.
			outputSchema: toAgentOutputSchema(fichaSchema) as never,
		});
		return saveStep(caller.tenantId, caller.userId, prepared.domain, raw);
	},
});
