// Las dependencias reales del servicio de dominios, armadas desde el entorno.
// Sin imports de Next: lo usan las acciones de la consola y un schedule de eve.
import { createAdminClient } from "../supabase/admin";
import { rootHostsFromEnv } from "../tenants/host";
import type { DomainDeps } from "./service";
import { supabaseDomainStore } from "./store";
import { supabaseAuthRedirectsFromEnv } from "./supabase-auth";
import { vercelDomainsFromEnv } from "./vercel";

export function domainDeps(): DomainDeps {
	return {
		store: supabaseDomainStore(createAdminClient()),
		vercel: vercelDomainsFromEnv(process.env),
		redirects: supabaseAuthRedirectsFromEnv(process.env),
		roots: rootHostsFromEnv(process.env),
		production: process.env.NODE_ENV === "production",
	};
}
