import { defineAgent, defineDynamic } from "eve";
import { createSupabaseOutreachStore } from "../../../../lib/outreach/store";
import { createAdminClient } from "../../../../lib/supabase/admin";

export default defineDynamic({
	events: {
		"session.started": async (_event, ctx) => {
			const auth = ctx.session.auth.initiator ?? ctx.session.auth.current;
			const tenantId = auth?.attributes?.tenantId;
			if (typeof tenantId !== "string") return null;
			const tenant = await createSupabaseOutreachStore(
				createAdminClient(),
			).loadTenantOutreach(tenantId);
			if (!tenant) return null;
			return defineAgent({
				description:
					"Investiga una empresa por su dominio y devuelve una ficha con hechos verificables, cada uno con la URL de donde sale. Lo usa research_account.",
				model: tenant.config.models.researcher,
			});
		},
	},
});
