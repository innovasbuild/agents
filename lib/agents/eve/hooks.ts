import { defineHook } from "eve/hooks";
import {
	bindSessionToConversation,
	closeRun,
	openRun,
} from "../session-store";
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
