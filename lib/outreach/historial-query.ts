// El historial que se despliega al abrir un contacto en /contactos. `events`
// es append-only, así que esto es la cronología real de lo que pasó, no un
// resumen que alguien mantiene al día.
import type { OutreachEventType } from "./events";

export const EVENT_LABELS: Record<OutreachEventType, string> = {
	contacto_importado: "Contacto importado",
	investigado: "Cuenta investigada",
	encolado: "Pieza encolada",
	gate_fallido: "No pasó el gate",
	pieza_editada: "Pieza editada",
	rechazado: "Pieza descartada",
	aprobado: "Pieza aprobada",
	envio: "Mail enviado",
	envio_fallido: "Falló el envío",
	rebote: "Rebotó",
	respuesta: "Respondió",
	cambio_etapa: "Cambio de etapa",
	claim_ajeno: "Contacto de otro ejecutor",
	deal_creado: "Oportunidad creada",
	oportunidad_frenada: "Oportunidad frenada",
	crm_sync_pendiente: "Falta sincronizar al CRM",
	crm_sync_ok: "Sincronizado al CRM",
	freno: "Freno",
	nota: "Nota",
};

/** Eventos que el operador tiene que poder encontrar de un vistazo. */
const PROBLEM_TYPES: readonly string[] = [
	"envio_fallido",
	"rebote",
	"gate_fallido",
	"claim_ajeno",
	"oportunidad_frenada",
	"crm_sync_pendiente",
	"freno",
];

export interface HistoryEntry {
	id: number;
	type: string;
	/** El tipo en castellano, o el tipo crudo si es uno que no conocemos. */
	label: string;
	detail: string | null;
	createdAt: string;
	problema: boolean;
}

const str = (value: unknown): string =>
	typeof value === "string" ? value : "";

export function toHistoryEntries(raw: readonly unknown[]): HistoryEntry[] {
	return raw
		.map((entry) => {
			const row = entry as Record<string, unknown>;
			const type = str(row.type);
			const payload =
				typeof row.payload === "object" && row.payload !== null
					? (row.payload as Record<string, unknown>)
					: {};
			const summary = typeof row.summary === "string" ? row.summary : null;
			const motivo = typeof payload.motivo === "string" ? payload.motivo : null;
			return {
				id: typeof row.id === "number" ? row.id : 0,
				type,
				// Un tipo desconocido se muestra crudo en vez de desaparecer: la lista
				// de tipos puede crecer en el runtime antes que acá.
				label: EVENT_LABELS[type as OutreachEventType] ?? type,
				detail: summary ?? motivo,
				createdAt: str(row.created_at),
				problema: PROBLEM_TYPES.includes(type),
			};
		})
		.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
