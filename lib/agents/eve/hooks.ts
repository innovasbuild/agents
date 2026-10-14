import { defineHook } from "eve/hooks";
import { createAdminClient } from "../../supabase/admin";
import { createUsageRecorder, resolveRunId } from "../../workflows/usage";
import { resolveModelForTenant } from "../model";
import {
	bindSessionToConversation,
	closeRun,
	openRun,
} from "../session-store";
import { stepUsageEntry } from "../step-usage";
import { attribute } from "./attribute";

/** Ata la sesión de eve a la conversación que la app creó antes de send(). */
export function bindSessionHook() {
	return defineHook({
		events: {
			async "session.started"(_event, ctx) {
				const auth = ctx.session.auth.initiator ?? ctx.session.auth.current;
				if (auth?.authenticator === "oauth") return;
				// Sin try/catch a propósito: si esto falla, el turno tiene que fallar.
				await bindSessionToConversation(
					attribute(auth?.attributes?.conversationId),
					ctx.session.id,
				);
			},
		},
	});
}

/**
 * Abre y cierra el run de cada turno. La observabilidad nunca puede tumbar un
 * turno real: un hook que tira termina en turn.failed (guides/hooks.md). Por
 * eso todo va en try/catch, al revés que bindSessionHook.
 *
 * `turnId` vive en `event.data.turnId` (no en `event.turnId`), y `turn.failed`
 * trae `event.data.message` (no `event.data.error`): así lo tipa eve en
 * dist/src/protocol/message.d.ts.
 */
export function runsHook() {
	return defineHook({
		events: {
			async "turn.started"(event, ctx) {
				try {
					const auth = ctx.session.auth.current ?? ctx.session.auth.initiator;
					const tenantId = attribute(auth?.attributes?.tenantId);
					if (!tenantId) return;

					await openRun({
						tenantId,
						conversationId:
							attribute(auth?.attributes?.conversationId) || null,
						agent: ctx.agent.name,
						sessionId: ctx.session.id,
						turnId: event.data.turnId,
						trigger: auth?.authenticator === "oauth" ? "mcp" : "chat",
					});
				} catch (error) {
					console.error("runs hook (turn.started):", error);
				}
			},
			async "turn.completed"(event, ctx) {
				try {
					await closeRun({
						sessionId: ctx.session.id,
						turnId: event.data.turnId,
						status: "ok",
					});
				} catch (error) {
					console.error("runs hook (turn.completed):", error);
				}
			},
			async "turn.failed"(event, ctx) {
				try {
					await closeRun({
						sessionId: ctx.session.id,
						turnId: event.data.turnId,
						status: "failed",
						error: event.data.message,
					});
				} catch (error) {
					console.error("runs hook (turn.failed):", error);
				}
			},
			async "turn.cancelled"(event, ctx) {
				try {
					await closeRun({
						sessionId: ctx.session.id,
						turnId: event.data.turnId,
						status: "cancelled",
					});
				} catch (error) {
					console.error("runs hook (turn.cancelled):", error);
				}
			},
		},
	});
}

// `step.completed` no trae el modelo; `step.started` sí. Se recuerda en
// memoria entre los dos: si el proceso cambió en el medio se pierde, y solo
// importa cuando además falta el costo (ahí se resuelve de nuevo).
const MAX_REMEMBERED = 500;
const models = new Map<string, string>();
const stepKey = (sessionId: string, turnId: string, stepIndex: number) =>
	`${sessionId}:${turnId}:${stepIndex}`;

/**
 * Asienta en usage_entries cada llamada al modelo del propio agente (spec
 * 21.5 §3). Las llamadas que hacen las tools por dentro las asienta `metered`
 * y no pasan por acá. Mismo principio que runsHook: la medición nunca puede
 * tumbar un turno, así que todo va en try/catch.
 */
export function usageHook() {
	return defineHook({
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
}
