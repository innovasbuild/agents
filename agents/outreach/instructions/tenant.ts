import { defineDynamic } from "eve";
import { defineInstructions } from "eve/instructions";
import { createSupabaseOutreachStore } from "../../../lib/outreach/store";
import { sessionSummary } from "../../../lib/outreach/summary";
import { createAdminClient } from "../../../lib/supabase/admin";

function attribute(value: unknown): string {
	return typeof value === "string" ? value : "";
}

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

			try {
				const content = await sessionSummary(
					{
						tenantId,
						userId: auth.principalId,
						tenantName: tenant.display_name,
						tenantSlug: tenant.slug,
					},
					{ store: createSupabaseOutreachStore(admin), now: () => new Date() },
				);
				return defineInstructions({ content });
			} catch (error) {
				// El resumen es contexto: si la base falla, la sesión arranca igual.
				console.error("instructions/tenant (resumen):", error);
				return defineInstructions({
					content: `Trabajás para ${tenant.display_name} (tenant \`${tenant.slug}\`). Todo lo que hagas es en nombre de ese cliente y con sus datos.`,
				});
			}
		},
	},
});
