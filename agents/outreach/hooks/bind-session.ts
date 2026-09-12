import { defineHook } from "eve/hooks";
import { bindSessionToConversation } from "../../../lib/agents/session-store";

function attribute(value: unknown): string {
	return typeof value === "string" ? value : "";
}

export default defineHook({
	events: {
		async "session.started"(_event, ctx) {
			const auth = ctx.session.auth.initiator ?? ctx.session.auth.current;
			// Sin try/catch a propósito: si esto falla, el turno tiene que fallar.
			await bindSessionToConversation(
				attribute(auth?.attributes?.conversationId),
				ctx.session.id,
			);
		},
	},
});
