// Identidad de una server action del dashboard. El equivalente web de
// callerFromSession (lib/outreach/session.ts): la identidad sale del
// servidor, nunca de un argumento que mandó el cliente.
import { createServerSupabase } from "@/lib/supabase/server";
import { resolveTenantAccess, type TenantAccess } from "@/lib/tenants/resolve";
import type { Caller } from "./session";

export interface WebSession {
	caller: Caller;
	tenant: TenantAccess;
}

export async function webSession(slug: string): Promise<WebSession | null> {
	const supabase = await createServerSupabase();
	const { data } = await supabase.auth.getUser();
	if (!data.user) return null;

	// resolveTenantAccess devuelve null si el slug no existe o si el usuario
	// no es miembro: las dos cosas se tratan igual, como en el layout.
	const tenant = await resolveTenantAccess(slug);
	if (!tenant) return null;

	return {
		caller: {
			tenantId: tenant.id,
			userId: data.user.id,
			role: tenant.role,
			email: data.user.email ?? "",
		},
		tenant,
	};
}
