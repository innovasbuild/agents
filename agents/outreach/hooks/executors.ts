import { defineHook } from "eve/hooks";
import { markGmailAuthorized } from "../../../lib/connectors/executors";

function attribute(value: unknown): string {
	return typeof value === "string" ? value : "";
}

// Mismo criterio que hooks/runs.ts: observabilidad, siempre en try/catch.
// "gmail" es el authKey que usa tools/send_email.ts. Verificado contra
// dist/src/protocol/message.d.ts y dist/src/runtime/connections/
// scoped-authorization.js de eve: el
// authKey pasado a ctx.getToken se usa tal cual como `scope`, y ese scope
// es el `name` que trae authorization.completed.
export default defineHook({
	events: {
		async "authorization.completed"(event, ctx) {
			try {
				if (event.data.name !== "gmail" || event.data.outcome !== "authorized")
					return;
				const auth = ctx.session.auth.current ?? ctx.session.auth.initiator;
				const tenantId = attribute(auth?.attributes?.tenantId);
				const userId = auth?.principalType === "user" ? auth.principalId : "";
				if (!tenantId || !userId) return;
				await markGmailAuthorized(tenantId, userId);
			} catch (error) {
				console.error("executors hook (authorization.completed):", error);
			}
		},
	},
});
