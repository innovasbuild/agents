// Tipos de evento de outreach (spec 03 §4.7). Genéricos para cualquier tenant.
export const OUTREACH_EVENT_TYPES = [
	"contacto_importado",
	"investigado",
	"encolado",
	"gate_fallido",
	"pieza_editada",
	"rechazado",
	"aprobado",
	"envio",
	"envio_fallido",
	"rebote",
	"respuesta",
	"cambio_etapa",
	"claim_ajeno",
	"deal_creado",
	"oportunidad_frenada",
	"crm_sync_pendiente",
	"crm_sync_ok",
	"freno",
	"nota",
] as const;

export type OutreachEventType = (typeof OUTREACH_EVENT_TYPES)[number];

/** Los únicos que el modelo puede registrar con log_event. */
export const MODEL_LOGGABLE_EVENT_TYPES = [
	"freno",
	"nota",
] as const satisfies readonly OutreachEventType[];

export interface OutreachEventInsert {
	tenant_id: string;
	actor_user_id: string | null;
	contact_key: string | null;
	channel: "email" | null;
	type: OutreachEventType;
	summary: string;
	payload: Record<string, unknown>;
	run_id: string | null;
}

export function outreachEvent(
	input: Omit<OutreachEventInsert, "channel" | "run_id"> & {
		channel?: "email" | null;
		run_id?: string | null;
	},
): OutreachEventInsert {
	if (!(OUTREACH_EVENT_TYPES as readonly string[]).includes(input.type)) {
		throw new Error(`tipo de evento de outreach desconocido: "${input.type}"`);
	}
	return {
		tenant_id: input.tenant_id,
		actor_user_id: input.actor_user_id,
		contact_key: input.contact_key,
		channel: input.channel === undefined ? "email" : input.channel,
		type: input.type,
		summary: input.summary.trim().slice(0, 500),
		payload: input.payload,
		run_id: input.run_id ?? null,
	};
}
