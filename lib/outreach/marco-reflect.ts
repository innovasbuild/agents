// Reflejo de hooks y vectores (spec 21.3 §3.5): el brain manda y
// config_values lo sigue. Si el marco no es válido no se escribe nada: sigue
// vigente lo último que se reflejó bien.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { BrainProvider } from "../brain/core/types";
import { createAdminClient } from "../supabase/admin";
import { brainForTenant, type CanonLoad, loadMarco } from "./canon";
import type { Marco } from "./canon-blocks";

export interface MarcoReflectCounts {
	upserts: number;
	deactivated: number;
	unchanged: number;
}

export type MarcoReflectResult =
	| ({ ok: true } & MarcoReflectCounts)
	| Extract<CanonLoad<Marco>, { ok: false }>;

export interface MarcoReflectStore {
	apply(tenantId: string, marco: Marco): Promise<MarcoReflectCounts>;
	recordFailure(
		tenantId: string,
		reason: string,
		errors: string[],
	): Promise<void>;
}

export async function reflectMarco(
	tenantId: string,
	deps: { brain: BrainProvider | null; store: MarcoReflectStore },
): Promise<MarcoReflectResult> {
	const loaded = await loadMarco(deps.brain);
	if (!loaded.ok) {
		// "sin_brain" y "falta" no son un fallo que avisar: la empresa todavía
		// no cargó su marco (por ejemplo, recién se crearon las plantillas).
		if (loaded.reason === "invalido" || loaded.reason === "brain_caido") {
			await deps.store.recordFailure(tenantId, loaded.reason, loaded.errors);
		}
		return loaded;
	}
	return { ok: true, ...(await deps.store.apply(tenantId, loaded.value)) };
}

export function supabaseMarcoStore(client: SupabaseClient): MarcoReflectStore {
	return {
		async apply(tenantId, marco) {
			// biome-ignore lint/suspicious/noExplicitAny: rpc() no está tipado en este repo
			const { data, error } = await (client as any).rpc(
				"outreach_reflect_marco",
				{ p_tenant: tenantId, p_hooks: marco.hooks, p_vectors: marco.vectores },
			);
			if (error) throw new Error(`no pude reflejar el marco: ${error.message}`);
			const counts = (data ?? {}) as Partial<MarcoReflectCounts>;
			return {
				upserts: Number(counts.upserts ?? 0),
				deactivated: Number(counts.deactivated ?? 0),
				unchanged: Number(counts.unchanged ?? 0),
			};
		},
		async recordFailure(tenantId, reason, errors) {
			const { error } = await client.from("events").insert({
				tenant_id: tenantId,
				type: "outreach.marco_reflect_failed",
				summary:
					reason === "brain_caido"
						? "no pude leer los hooks y vectores del brain"
						: `los bloques de hooks y vectores no son válidos (${errors.length} errores)`,
				payload: { reason, errors: errors.slice(0, 20) },
			});
			if (error)
				console.error("marco: no pude registrar el fallo:", error.message);
		},
	};
}

export async function reflectMarcoForTenant(
	tenantId: string,
): Promise<MarcoReflectResult> {
	return reflectMarco(tenantId, {
		brain: await brainForTenant(tenantId),
		store: supabaseMarcoStore(createAdminClient()),
	});
}
