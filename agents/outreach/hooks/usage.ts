import { defineHook } from "eve/hooks";
import { resolveModelForTenant } from "../../../lib/agents/model";
import { stepUsageEntry } from "../../../lib/agents/step-usage";
import { createAdminClient } from "../../../lib/supabase/admin";
import {
	createUsageRecorder,
	resolveRunId,
} from "../../../lib/workflows/usage";

function attribute(value: unknown): string {
	return typeof value === "string" ? value : "";
}

// `step.completed` no trae el modelo; `step.started` sí. Se recuerda en
// memoria entre los dos: si el proceso cambió en el medio se pierde, y solo
// importa cuando además falta el costo (ahí se resuelve de nuevo).
const MAX_REMEMBERED = 500;
const models = new Map<string, string>();
const stepKey = (sessionId: string, turnId: string, stepIndex: number) =>
	`${sessionId}:${turnId}:${stepIndex}`;

// Asienta en usage_entries cada llamada al modelo del propio agente (spec
// 21.5 §3). Las llamadas que hacen las tools por dentro las asienta `metered`
// y no pasan por acá. Mismo principio que hooks/runs.ts: la medición nunca
// puede tumbar un turno, así que todo va en try/catch.
export default defineHook({
	events: {
		async "step.started"(event, ctx) {
			try {
				if (models.size >= MAX_REMEMBERED) models.clear();
				models.set(
					stepKey(ctx.session.id, event.data.turnId, event.data.stepIndex),
					event.data.modelId,
				);
			} catch (error) {
				console.error("usage hook (step.started):", error);
			}
		},
		async "step.completed"(event, ctx) {
			try {
				const { turnId, stepIndex, usage } = event.data;
				const key = stepKey(ctx.session.id, turnId, stepIndex);
				let modelId = models.get(key) ?? null;
				models.delete(key);

				const auth = ctx.session.auth.current ?? ctx.session.auth.initiator;
				const tenantId = attribute(auth?.attributes?.tenantId);
				if (!tenantId || !usage) return;

				if (modelId === null && usage.costUsd === undefined) {
					modelId = await resolveModelForTenant(
						tenantId,
						ctx.agent.name,
						attribute(auth?.attributes?.conversationId) || null,
					);
				}

				const admin = createAdminClient();
				const entry = stepUsageEntry({
					tenantId,
					runId: await resolveRunId(admin, ctx.session.id, turnId),
					agent: ctx.agent.name,
					modelId,
					stepIndex,
					usage,
				});
				if (entry) await createUsageRecorder(admin)(entry);
			} catch (error) {
				console.error("usage hook (step.completed):", error);
			}
		},
	},
});
