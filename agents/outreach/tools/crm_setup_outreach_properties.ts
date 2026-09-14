import { defineTool } from "eve/tools";
import { always } from "eve/tools/approval";
import { z } from "zod";
import { tenantScopedConnect } from "../../../lib/connectors/auth";
import { hasEnabledBinding } from "../../../lib/connectors/bindings";
import {
	ensureOutreachProperties,
	HubSpotUnauthorizedError,
} from "../../../lib/connectors/crm/hubspot";
import { HUBSPOT_CONNECTOR_UID } from "../../../lib/connectors/platform";

function attribute(value: unknown): string {
	return typeof value === "string" ? value : "";
}

const AUTH_OPTIONS = { authKey: "hubspot", displayName: "HubSpot" } as const;

export default defineTool({
	description:
		"Crea en el HubSpot del tenant las propiedades custom de outreach que falten (grupo outreach). Idempotente. Solo para tenant_admin o platform_admin.",
	inputSchema: z.object({}),
	approval: always(),
	async execute(_input, ctx) {
		const auth = ctx.session.auth.current;
		if (auth?.principalType !== "user") {
			throw new Error(
				"crm_setup_outreach_properties requiere un usuario autenticado",
			);
		}
		const tenantId = attribute(auth.attributes?.tenantId);
		const role = attribute(auth.attributes?.role);
		if (!tenantId) throw new Error("la sesión no tiene tenant");
		if (role !== "tenant_admin" && role !== "platform_admin") {
			throw new Error(
				"solo un tenant_admin o platform_admin puede crear las propiedades de outreach",
			);
		}
		if (!(await hasEnabledBinding(tenantId, "crm", "hubspot"))) {
			throw new Error("este tenant no tiene HubSpot conectado");
		}

		const provider = tenantScopedConnect(HUBSPOT_CONNECTOR_UID, tenantId);
		const { token } = await ctx.getToken(provider, AUTH_OPTIONS);
		try {
			return await ensureOutreachProperties(token);
		} catch (error) {
			if (error instanceof HubSpotUnauthorizedError)
				ctx.requireAuth(provider, AUTH_OPTIONS);
			throw error;
		}
	},
});
