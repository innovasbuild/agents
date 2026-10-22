// Zona horaria de la empresa para el corte diario de enterprise. Vive en la
// config del agente outreach (tenant_agents.config.timezone); sin ella, la de
// la casa. Imports relativos: lo usan hooks que eve empaqueta.
import type { PlanAdminLike } from "./store";

export const DEFAULT_TIMEZONE = "America/Argentina/Buenos_Aires";

export async function tenantTimezone(
	admin: PlanAdminLike,
	tenantId: string,
): Promise<string> {
	try {
		const { data } = await admin
			.from("tenant_agents")
			.select("config")
			.eq("tenant_id", tenantId)
			.eq("agent", "outreach")
			.maybeSingle();
		const tz = (data?.config as { timezone?: unknown } | null)?.timezone;
		return typeof tz === "string" && tz.length > 0 ? tz : DEFAULT_TIMEZONE;
	} catch {
		return DEFAULT_TIMEZONE;
	}
}
