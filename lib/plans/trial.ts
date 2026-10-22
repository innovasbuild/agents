// Vencimiento del plan Free (spec 27.1 §3, §5.5): a los 3 meses la empresa
// pasa a `suspended_reason = 'trial_vencido'`. Lo corre un schedule diario de
// eve, así que este archivo no importa nada de next/* ni usa el alias "@/".
import type { SupabaseClient } from "@supabase/supabase-js";

export interface TrialStore {
	/** plan='free', activa, sin suspender y con trial_ends_at < now. */
	listExpired(
		now: Date,
		limit: number,
	): Promise<{ id: string; slug: string }[]>;
	/** Suspende y deja el evento tenant.suspended. */
	suspend(tenantId: string, reason: "trial_vencido"): Promise<void>;
}

export function createTrialStore(admin: SupabaseClient): TrialStore {
	return {
		async listExpired(now, limit) {
			const { data, error } = await admin
				.from("tenants")
				.select("id, slug")
				.eq("plan", "free")
				.is("suspended_reason", null)
				.eq("active", true)
				.lt("trial_ends_at", now.toISOString())
				.order("trial_ends_at")
				.limit(limit);
			if (error) throw new Error(`listExpired: ${error.message}`);
			return (data ?? []) as { id: string; slug: string }[];
		},

		async suspend(tenantId, reason) {
			// Condicional: si en el medio pagó (plan != free) o ya lo suspendieron,
			// el update no toca nada y no se registra el evento.
			const { data, error } = await admin
				.from("tenants")
				.update({ suspended_reason: reason })
				.eq("id", tenantId)
				.is("suspended_reason", null)
				.eq("plan", "free")
				.select("id");
			if (error) throw new Error(`suspend: ${error.message}`);
			if (!data || data.length === 0) return;

			const { error: eventError } = await admin.from("events").insert({
				tenant_id: tenantId,
				type: "tenant.suspended",
				summary: "Plan gratis vencido",
				payload: { reason },
			});
			// La suspensión ya quedó hecha: el asiento perdido se loguea, no se deshace.
			if (eventError) {
				console.error(
					`trial-expiry: no se pudo registrar el evento de ${tenantId}: ${eventError.message}`,
				);
			}
		},
	};
}

export async function expireTrials(
	deps: { store: TrialStore; now: () => Date },
	limit = 100,
): Promise<{ checked: number; suspended: number }> {
	let expired: { id: string; slug: string }[];
	try {
		expired = await deps.store.listExpired(deps.now(), limit);
	} catch (error) {
		console.error("trial-expiry: no se pudo listar los vencidos", error);
		return { checked: 0, suspended: 0 };
	}

	let suspended = 0;
	for (const tenant of expired) {
		try {
			await deps.store.suspend(tenant.id, "trial_vencido");
			suspended++;
		} catch (error) {
			console.error(`trial-expiry: falló ${tenant.id} (${tenant.slug})`, error);
		}
	}
	return { checked: expired.length, suspended };
}
