import { defineHook } from "eve/hooks";
import { closeRun, openRun } from "../../../lib/agents/session-store";

function attribute(value: unknown): string {
	return typeof value === "string" ? value : "";
}

// La observabilidad nunca puede tumbar un turno real: un hook que tira
// termina en turn.failed (guides/hooks.md). Por eso todo va en try/catch,
// al revés que bind-session.
//
// `turnId` vive en `event.data.turnId` (no en `event.turnId`), y
// `turn.failed` trae `event.data.message` (no `event.data.error`): así lo
// tipa eve en dist/src/protocol/message.d.ts.
export default defineHook({
	events: {
		async "turn.started"(event, ctx) {
			try {
				const auth = ctx.session.auth.current ?? ctx.session.auth.initiator;
				const tenantId = attribute(auth?.attributes?.tenantId);
				if (!tenantId) return;

				await openRun({
					tenantId,
					conversationId: attribute(auth?.attributes?.conversationId) || null,
					agent: ctx.agent.name,
					sessionId: ctx.session.id,
					turnId: event.data.turnId,
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
