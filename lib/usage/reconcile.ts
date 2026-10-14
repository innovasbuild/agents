// Compara el libro (usage_entries) contra el reporte del AI Gateway por tag
// (spec 21.5 §5.3). Puro: la acción junta los datos y esto arma la tabla.
import { DAY_MS, monthRange, type Period, utcDayStart } from "./report";

export const TOLERANCE_USD = 1;
export const TOLERANCE_PCT = 0.05;
// Medio centavo: el mínimo que se ve en pantalla (el reporte redondea).
const ROUNDING_USD = 0.005;

const TAG_PREFIX = "tenant:";
const isoDay = (date: Date) => date.toISOString().slice(0, 10);

/**
 * Qué días conciliar. El mes en curso llega hasta ayer: el gateway demora en
 * ingerir y el día de hoy nunca cierra. `startDate` y `endDate` son inclusive
 * (así los pide el gateway); `[from, to)` es el mismo rango para el libro.
 * `null` si todavía no hay un día cerrado.
 */
export function reconcileRange(
	period: Period,
	now: Date,
): { startDate: string; endDate: string; from: Date; to: Date } | null {
	const month = monthRange(period, now);
	const today = utcDayStart(now);
	const to = period === "actual" ? today : month.to;
	if (to.getTime() <= month.from.getTime()) return null;
	return {
		startDate: isoDay(month.from),
		endDate: isoDay(new Date(to.getTime() - DAY_MS)),
		from: month.from,
		to,
	};
}

export interface ReconcileLine {
	key: string;
	kind: "empresa" | "tag_sin_empresa" | "sin_etiqueta";
	label: string;
	ledger: number;
	gateway: number;
	diff: number;
	diffPct: number | null;
	flagged: boolean;
}

function line(
	base: Pick<ReconcileLine, "key" | "kind" | "label">,
	ledger: number,
	gateway: number,
): ReconcileLine {
	const diff = ledger - gateway;
	return {
		...base,
		ledger,
		gateway,
		diff,
		diffPct: gateway > 0 ? diff / gateway : null,
		flagged: Math.abs(diff) > Math.max(TOLERANCE_USD, TOLERANCE_PCT * gateway),
	};
}

export function reconcile(input: {
	tenants: { id: string; slug: string; name: string }[];
	ledger: { tenantId: string; amount: number }[];
	gatewayByTag: { tag?: string; totalCost: number }[];
	gatewayTotal: number;
}): ReconcileLine[] {
	const ledger = new Map<string, number>();
	for (const row of input.ledger) {
		ledger.set(row.tenantId, (ledger.get(row.tenantId) ?? 0) + row.amount);
	}

	// El tag lleva el slug; si la base falló al resolverlo lleva el id
	// (lib/workflows/gateway-options.ts). Los dos son de la misma empresa.
	const byKey = new Map<string, string>();
	for (const tenant of input.tenants) {
		byKey.set(tenant.slug, tenant.id);
		byKey.set(tenant.id, tenant.id);
	}

	const gateway = new Map<string, number>();
	const orphans = new Map<string, number>();
	let tagged = 0;
	for (const row of input.gatewayByTag) {
		if (!row.tag?.startsWith(TAG_PREFIX)) continue;
		tagged += row.totalCost;
		const tenantId = byKey.get(row.tag.slice(TAG_PREFIX.length));
		if (tenantId) {
			gateway.set(tenantId, (gateway.get(tenantId) ?? 0) + row.totalCost);
		} else {
			orphans.set(row.tag, (orphans.get(row.tag) ?? 0) + row.totalCost);
		}
	}

	const lines: ReconcileLine[] = [];
	for (const tenant of input.tenants) {
		const inLedger = ledger.get(tenant.id) ?? 0;
		const inGateway = gateway.get(tenant.id) ?? 0;
		if (inLedger === 0 && inGateway === 0) continue;
		lines.push(
			line(
				{ key: tenant.id, kind: "empresa", label: tenant.name },
				inLedger,
				inGateway,
			),
		);
	}
	for (const [tag, cost] of orphans) {
		// Gasto del gateway que el libro no puede atribuir: siempre se marca.
		lines.push({
			...line({ key: tag, kind: "tag_sin_empresa", label: tag }, 0, cost),
			flagged: true,
		});
	}

	// Lo que el gateway cobró sin tag de empresa: una llamada sin etiquetar.
	const untagged = Math.max(0, input.gatewayTotal - tagged);
	lines.push({
		...line(
			{ key: "sin_etiqueta", kind: "sin_etiqueta", label: "Sin etiqueta" },
			0,
			untagged,
		),
		flagged: untagged > ROUNDING_USD,
	});
	return lines;
}
