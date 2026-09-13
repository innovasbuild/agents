import { defineDynamic } from "eve/connections";
import { loadTenantBindings } from "../../../lib/connectors/bindings";
import { resolveTenantConnections } from "../../../lib/connectors/resolve";

function attribute(value: unknown): string {
	return typeof value === "string" ? value : "";
}

// Un solo resolver para todas las conexiones del tenant (spec 02 D7). Un
// tenant sin binding de una capacidad simplemente no tiene esa clave.
export default defineDynamic({
	events: {
		"session.started": async (_event, ctx) => {
			const auth = ctx.session.auth.initiator ?? ctx.session.auth.current;
			return resolveTenantConnections(
				attribute(auth?.attributes?.tenantId),
				loadTenantBindings,
			);
		},
	},
});
