// Lectura de solo lectura para /settings: ejecutores y conexiones. Las dos
// tablas son planas (sin embeds), así que esto es normalización defensiva,
// no un join.
export interface ExecutorRow {
	userId: string;
	slug: string | null;
	dailyQuota: number;
	gmailAuthorizedAt: string | null;
}

export interface ConnectionRow {
	id: string;
	capability: string;
	provider: string;
	enabled: boolean;
}

const str = (value: unknown): string =>
	typeof value === "string" ? value : "";
const nullableStr = (value: unknown): string | null =>
	typeof value === "string" ? value : null;

export function toExecutorRows(raw: readonly unknown[]): ExecutorRow[] {
	return raw.map((entry) => {
		const row = entry as Record<string, unknown>;
		return {
			userId: str(row.user_id),
			slug: nullableStr(row.slug),
			dailyQuota: typeof row.daily_quota === "number" ? row.daily_quota : 0,
			gmailAuthorizedAt: nullableStr(row.gmail_authorized_at),
		};
	});
}

export function toConnectionRows(raw: readonly unknown[]): ConnectionRow[] {
	return raw.map((entry) => {
		const row = entry as Record<string, unknown>;
		return {
			id: str(row.id),
			capability: str(row.capability),
			provider: str(row.provider),
			enabled: row.enabled === true,
		};
	});
}
