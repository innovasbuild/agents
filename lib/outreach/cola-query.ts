// Normaliza la lectura de la cola. PostgREST devuelve un embed como objeto o
// como array según la cardinalidad que infiere; las dos formas se aplanan acá
// para que la UI no tenga que saberlo.
export interface ColaRow {
	id: string;
	subject: string;
	body: string;
	toEmail: string;
	kind: string;
	status: "pending" | "approved";
	hook: string;
	vector: string;
	expiresAt: string;
	error: string | null;
	ownerSlug: string | null;
	ownerUserId: string;
	contactName: string | null;
	contactCompany: string | null;
	contactStage: string | null;
	/** approved sin enviar: el turno murió entre el claim y el envío. */
	trabada: boolean;
}

const first = <T>(value: T | T[] | null | undefined): T | null => {
	if (value === null || value === undefined) return null;
	return Array.isArray(value) ? (value[0] ?? null) : value;
};

const str = (value: unknown): string =>
	typeof value === "string" ? value : "";
const nullableStr = (value: unknown): string | null =>
	typeof value === "string" ? value : null;

export function toColaRows(raw: readonly unknown[]): ColaRow[] {
	return raw.map((entry) => {
		const row = entry as Record<string, unknown>;
		const owner = first(row.executors as { slug?: unknown } | null);
		const contact = first(
			row.contacts as {
				name?: unknown;
				company?: unknown;
				stage?: unknown;
			} | null,
		);
		const status = row.status === "approved" ? "approved" : "pending";
		return {
			id: str(row.id),
			subject: str(row.subject),
			body: str(row.body),
			toEmail: str(row.to_email),
			kind: str(row.kind),
			status,
			hook: str(row.hook),
			vector: str(row.vector),
			expiresAt: str(row.expires_at),
			error: nullableStr(row.error),
			ownerSlug: nullableStr(owner?.slug),
			ownerUserId: str(row.executor_user_id),
			contactName: nullableStr(contact?.name),
			contactCompany: nullableStr(contact?.company),
			contactStage: nullableStr(contact?.stage),
			trabada: status === "approved",
		};
	});
}
