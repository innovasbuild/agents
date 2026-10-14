// Reporte de gasto en modelos por período (spec 21.5 §5). Puro: recibe lo que
// devuelven tenant_spend_report y platform_spend_report. Todo en UTC (G7).

export type Period = "actual" | "anterior";

export function parsePeriod(value: unknown): Period {
	return value === "anterior" ? "anterior" : "actual";
}

const MONTHS = [
	"enero",
	"febrero",
	"marzo",
	"abril",
	"mayo",
	"junio",
	"julio",
	"agosto",
	"septiembre",
	"octubre",
	"noviembre",
	"diciembre",
];

/** Rango `[from, to)` del mes, en UTC. Date.UTC normaliza el mes -1 y el 12. */
export function monthRange(
	period: Period,
	now: Date,
): { from: Date; to: Date; label: string } {
	const shift = period === "actual" ? 0 : -1;
	const year = now.getUTCFullYear();
	const month = now.getUTCMonth() + shift;
	const from = new Date(Date.UTC(year, month, 1));
	const to = new Date(Date.UTC(year, month + 1, 1));
	return {
		from,
		to,
		label: `${MONTHS[from.getUTCMonth()]} de ${from.getUTCFullYear()}`,
	};
}

// Postgres devuelve numeric como texto según el camino.
const num = (value: unknown): number => {
	const parsed = typeof value === "string" ? Number(value) : value;
	return typeof parsed === "number" && Number.isFinite(parsed) ? parsed : 0;
};

const DAY = /^\d{4}-\d{2}-\d{2}$/;

export interface SpendRow {
	day: string;
	origin: string;
	amount: number;
}

export function toSpendRows(raw: readonly unknown[]): SpendRow[] {
	return raw.flatMap((entry) => {
		if (typeof entry !== "object" || entry === null) return [];
		const row = entry as Record<string, unknown>;
		return typeof row.day === "string" &&
			DAY.test(row.day) &&
			typeof row.origin === "string"
			? [{ day: row.day, origin: row.origin, amount: num(row.amount) }]
			: [];
	});
}

const ORIGIN_LABELS: Record<string, string> = {
	chat: "Chat",
	sin_corrida: "Procesos programados",
};

export function originLabel(origin: string): string {
	return Object.hasOwn(ORIGIN_LABELS, origin) ? ORIGIN_LABELS[origin] : origin;
}

export function summarize(rows: readonly SpendRow[]): {
	total: number;
	byDay: { day: string; amount: number }[];
	byOrigin: { origin: string; label: string; amount: number }[];
} {
	const days = new Map<string, number>();
	const origins = new Map<string, number>();
	let total = 0;
	for (const row of rows) {
		total += row.amount;
		days.set(row.day, (days.get(row.day) ?? 0) + row.amount);
		origins.set(row.origin, (origins.get(row.origin) ?? 0) + row.amount);
	}
	return {
		total,
		byDay: [...days]
			.map(([day, amount]) => ({ day, amount }))
			.sort((a, b) => a.day.localeCompare(b.day)),
		byOrigin: [...origins]
			.map(([origin, amount]) => ({
				origin,
				label: originLabel(origin),
				amount,
			}))
			.sort((a, b) => b.amount - a.amount),
	};
}

export interface PlatformRow {
	tenantId: string;
	day: string;
	amount: number;
}

export function toPlatformRows(raw: readonly unknown[]): PlatformRow[] {
	return raw.flatMap((entry) => {
		if (typeof entry !== "object" || entry === null) return [];
		const row = entry as Record<string, unknown>;
		return typeof row.tenant_id === "string" &&
			typeof row.day === "string" &&
			DAY.test(row.day)
			? [{ tenantId: row.tenant_id, day: row.day, amount: num(row.amount) }]
			: [];
	});
}

export function platformTotals(
	rows: readonly PlatformRow[],
	now: Date,
): Map<string, { today: number; month: number; previous: number }> {
	const today = now.toISOString().slice(0, 10);
	const month = today.slice(0, 7);
	const previous = monthRange("anterior", now).from.toISOString().slice(0, 7);
	const totals = new Map<
		string,
		{ today: number; month: number; previous: number }
	>();
	for (const row of rows) {
		const entry = totals.get(row.tenantId) ?? {
			today: 0,
			month: 0,
			previous: 0,
		};
		if (row.day === today) entry.today += row.amount;
		if (row.day.startsWith(month)) entry.month += row.amount;
		if (row.day.startsWith(previous)) entry.previous += row.amount;
		totals.set(row.tenantId, entry);
	}
	return totals;
}

export function usd(amount: number): string {
	return `US$ ${amount.toLocaleString("es-AR", {
		minimumFractionDigits: 2,
		maximumFractionDigits: 2,
	})}`;
}

/** `2026-10-05` → `05/10/2026`, sin pasar por Date para no correr el día. */
export function dayLabel(day: string): string {
	const [year, month, date] = day.split("-");
	return `${date}/${month}/${year}`;
}
