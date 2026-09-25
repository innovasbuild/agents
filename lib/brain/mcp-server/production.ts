// Dependencias reales del endpoint MCP del brain. El verificador de claims
// (y el store y el contador que van con service role) se arman una sola vez
// por proceso: así la caché de JWKS de supabaseClaimsVerifier() sobrevive
// entre requests en vez de reconstruirse en cada llamada.
import { getBrainProvider } from "../provider.ts";
import type { BrainMcpDeps } from "./handler.ts";
import {
	supabaseAccessStore,
	supabaseClaimsVerifier,
	supabaseHit,
} from "./supabase.ts";

let memoized: Pick<BrainMcpDeps, "verify" | "store" | "hit"> | undefined;

function sharedDeps(): Pick<BrainMcpDeps, "verify" | "store" | "hit"> {
	if (!memoized) {
		memoized = {
			verify: supabaseClaimsVerifier(),
			store: supabaseAccessStore(),
			hit: supabaseHit(),
		};
	}
	return memoized;
}

export function publicSettings(): Pick<BrainMcpDeps, "publicUrl" | "issuer"> {
	const publicUrl = process.env.PUBLIC_APP_URL?.replace(/\/$/, "");
	const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/$/, "");
	if (!publicUrl || !supabaseUrl) {
		throw new Error(
			"faltan PUBLIC_APP_URL o NEXT_PUBLIC_SUPABASE_URL para el brain por MCP",
		);
	}
	return { publicUrl, issuer: `${supabaseUrl}/auth/v1` };
}

export function productionDeps(): BrainMcpDeps {
	return {
		...publicSettings(),
		...sharedDeps(),
		provider: getBrainProvider,
	};
}
