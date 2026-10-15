// Dependencias reales del endpoint MCP del brain. El verificador de claims
// (y el store y el contador que van con service role) se arman una sola vez
// por proceso: así la caché de JWKS de supabaseClaimsVerifier() sobrevive
// entre requests en vez de reconstruirse en cada llamada.
import { createUnauthorizedResponse } from "eve/channels/auth";
import { createAdminClient } from "../../supabase/admin";
import type { RequestHostContext } from "../../tenants/host-store";
import { fallbackPublicUrl } from "../../tenants/public-url";
import { agentsNeedCanon } from "../../tenants/readiness";
import type {
	BrainMcpDeps,
	McpSkillsDeps,
} from "../core/mcp-server/handler.ts";
import { issuePackageLink } from "../core/skills/package-link.ts";
import { accessRulesStore } from "./access-rules.ts";
import {
	supabaseAccessStore,
	supabaseClaimsVerifier,
	supabaseHit,
} from "./mcp-supabase.ts";
import { getBrainProvider } from "./provider.ts";
import { packageLinkDeps } from "./skill-packages.ts";
import { blobStore, skillStore } from "./skill-storage.ts";

let memoized:
	| Pick<BrainMcpDeps, "verify" | "store" | "hit" | "rules">
	| undefined;

function sharedDeps(): Pick<
	BrainMcpDeps,
	"verify" | "store" | "hit" | "rules"
> {
	if (!memoized) {
		memoized = {
			verify: supabaseClaimsVerifier(),
			store: supabaseAccessStore(),
			hit: supabaseHit(),
			rules: accessRulesStore(),
		};
	}
	return memoized;
}

type SkillLoad = Parameters<McpSkillsDeps["record"]>[0];

export function skillLoadEvent(entry: SkillLoad): Record<string, unknown> {
	return {
		tenant_id: entry.tenantId,
		actor_user_id: entry.userId,
		channel: "mcp",
		type: "brain.skill_loaded",
		summary: entry.slug,
		payload: { name: entry.name, version: entry.version, digest: entry.digest },
	};
}

function skillsDeps(): McpSkillsDeps {
	return {
		overview: (tenantId) => skillStore().overview(tenantId),
		blob: (tenantId, sha256) => blobStore().get(tenantId, sha256),
		// events es append-only: solo insert. Se tira solo el mensaje de la base,
		// nunca el objeto de error entero, para no filtrar datos de la conexión.
		async record(entry) {
			const { error } = await createAdminClient()
				.from("events")
				.insert(skillLoadEvent(entry));
			if (error) throw new Error(error.message);
		},
		issue: (request) =>
			issuePackageLink({ ...request, channel: "mcp" }, packageLinkDeps()),
		// Para crear y editar el borrador desde un asistente (spec 24.5).
		edit: { store: skillStore(), blobs: blobStore() },
	};
}

export function publicSettings(
	origin?: string,
): Pick<BrainMcpDeps, "publicUrl" | "issuer"> {
	// PUBLIC_APP_URL solo está cargada en Production (Etapa 11): en Preview y
	// Development no tiene sentido un valor fijo, porque cada deploy de Vercel
	// tiene su propia URL. VERCEL_URL la pone Vercel solo, en todo ambiente
	// (incluidos los que evalúa eve al buildear un canal, antes de servir
	// ningún request) — sin este fallback, un canal de eve que llama a esta
	// función a nivel de módulo tira el build entero de cualquier preview.
	// Con un origen por request (el dominio de una empresa, spec 21.6) se usa ese;
	// sin él, el fijo del proceso, como siempre.
	const publicUrl = origin || fallbackPublicUrl(process.env);
	const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/$/, "");
	if (!publicUrl || !supabaseUrl) {
		throw new Error(
			"faltan PUBLIC_APP_URL (o VERCEL_URL) o NEXT_PUBLIC_SUPABASE_URL para el brain por MCP",
		);
	}
	return { publicUrl, issuer: `${supabaseUrl}/auth/v1` };
}

export function productionDeps(
	host?: Pick<RequestHostContext, "publicUrl" | "tenantHost" | "serves">,
): BrainMcpDeps {
	return {
		...publicSettings(host?.tenantHost ? host.publicUrl : undefined),
		// El host raíz no valida (como hoy); cualquier otro solo sirve a su empresa.
		...(host && { tenantHost: host.tenantHost, hostServes: host.serves }),
		...sharedDeps(),
		provider: getBrainProvider,
		skills: skillsDeps(),
		usesCanon: async (tenantId) => {
			// Si no se puede leer, las descripciones de siempre (con canon): una
			// empresa con outreach no pierde la guía por una lectura caída.
			try {
				const { data, error } = await createAdminClient()
					.from("tenant_agents")
					.select("agent")
					.eq("tenant_id", tenantId)
					.eq("enabled", true);
				if (error) {
					console.error("brain mcp: no pude leer los agentes:", error.message);
					return true;
				}
				return agentsNeedCanon(data ?? []);
			} catch (error) {
				console.error("brain mcp: no pude leer los agentes:", error);
				return true;
			}
		},
		unauthorized: createUnauthorizedResponse,
	};
}
