import { defineDynamic } from "eve";
import { defineInstructions } from "eve/instructions";
import { assistantSessionInstructions } from "../../../lib/agents/assistant-instructions";
import { AGENT_CATALOG } from "../../../lib/agents/catalog";
import { attribute } from "../../../lib/agents/eve/attribute";
import { resolveBrainBinding } from "../../../lib/brain/core/resolve";
import { loadTenantBindings } from "../../../lib/connectors/bindings";
import { createAdminClient } from "../../../lib/supabase/admin";
import { chatAgents } from "../../../lib/tenants/home";

export default defineDynamic({
	events: {
		"session.started": async (_event, ctx) => {
			const auth = ctx.session.auth.initiator ?? ctx.session.auth.current;
			const tenantId = attribute(auth?.attributes?.tenantId);
			if (!tenantId || auth?.principalType !== "user") return null;

			const admin = createAdminClient();
			const { data: tenant } = await admin
				.from("tenants")
				.select("display_name, slug")
				.eq("id", tenantId)
				.maybeSingle();
			if (!tenant) return null;

			const base = {
				tenantName: tenant.display_name,
				tenantSlug: tenant.slug,
			};

			try {
				const { data: rows, error } = await admin
					.from("tenant_agents")
					.select("agent")
					.eq("tenant_id", tenantId)
					.eq("enabled", true);
				if (error) throw new Error(error.message);

				const otherAgents = chatAgents((rows ?? []).map((row) => row.agent))
					.filter((agent) => agent !== "asistente")
					.map((agent) => ({
						name: AGENT_CATALOG[agent].name,
						description: AGENT_CATALOG[agent].description,
					}));
				const brainConnected =
					(await resolveBrainBinding(tenantId, loadTenantBindings)) !== null;

				return defineInstructions({
					content: assistantSessionInstructions({
						...base,
						brainConnected,
						otherAgents,
					}),
				});
			} catch (error) {
				// El contexto es ayuda: si la base falla, la sesión arranca igual,
				// con la versión que no promete ningún otro agente.
				console.error("asistente instructions/tenant:", error);
				return defineInstructions({
					content: assistantSessionInstructions({
						...base,
						brainConnected: true,
						otherAgents: [],
					}),
				});
			}
		},
	},
});
