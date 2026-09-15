import { defineTool } from "eve/tools";
import { z } from "zod";
import { crmForSession } from "../../../lib/outreach/crm-session";
import { importContacts } from "../../../lib/outreach/services/import-contacts";
import { callerFromSession } from "../../../lib/outreach/session";
import { createSupabaseOutreachStore } from "../../../lib/outreach/store";
import { createAdminClient } from "../../../lib/supabase/admin";

// Sin approval: escribe solo en la base de la plataforma y lee el CRM.
export default defineTool({
	description:
		"Carga contactos desde un CSV pegado en el chat (columnas: name, email, linkedin_url, company, domain, segment, vector; hasta 50 filas) y devuelve un veredicto por fila: nuevo, ya_existia, claim_ajeno, sin_email o invalida. No escribe en el CRM. Si una fila es claim_ajeno, no insistas con esa persona.",
	inputSchema: z.object({ csv: z.string().min(1).max(100_000) }),
	async execute({ csv }, ctx) {
		const caller = callerFromSession(ctx.session);
		const crm = await crmForSession(ctx, caller.tenantId);
		return importContacts(
			{ csv, caller },
			{
				store: createSupabaseOutreachStore(createAdminClient()),
				crm: crm?.adapter ?? null,
				now: () => new Date(),
			},
		);
	},
});
